#!/usr/bin/env bash
# نقل البيانات الحالية من Neon إلى قاعدة السيرفر (مرة واحدة، قبل توجيه النطاق للسيرفر)
#   sudo /opt/midar/deploy/import-neon.sh 'postgresql://neondb_owner:...@ep-xxx.neon.tech/neondb?sslmode=require'
# يستخدم رابط المالك من Neon. القاعدة المحلية تُفرَّغ ثم تُملأ ببيانات Neon كاملة.
set -euo pipefail
SRC="${1:?ضع رابط Neon (رابط المالك) بين علامتي تنصيص}"
APP=/opt/midar; TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# نفس إصدار pg_dump أو أحدث من Neon
VER=$(psql "$SRC" -Atc "SHOW server_version_num" | cut -c1-2)
if ! /usr/lib/postgresql/"$VER"/bin/pg_dump --version >/dev/null 2>&1; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq && apt-get install -y -qq "postgresql-client-$VER" >/dev/null
fi
echo "▶ تنزيل البيانات من Neon (PostgreSQL $VER)"
/usr/lib/postgresql/"$VER"/bin/pg_dump -Fc --no-owner "$SRC" -f "$TMP/neon.dump"

echo "▶ نسخة احتياطية من القاعدة المحلية قبل الاستبدال"
"$APP/deploy/backup.sh" || true

systemctl stop midar
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS midar" -c "CREATE DATABASE midar OWNER midar_owner"
sudo -u postgres psql -q -d midar -v ON_ERROR_STOP=1 -c "ALTER SCHEMA public OWNER TO midar_owner" -c "GRANT USAGE ON SCHEMA public TO midar_app"
echo "▶ استرجاع البيانات"
OWN=$(grep -oP '^MIGRATION_DATABASE_URL=\K.*' "$APP/.env")
# صلاحيات الأدوار الخاصة بـ Neon (neondb_owner) لا توجد هنا: أخطاؤها متوقعة ولا تؤثر
/usr/lib/postgresql/"$VER"/bin/pg_restore --no-owner -d "$OWN" "$TMP/neon.dump" 2> "$TMP/restore.log" || true
grep -v -E 'neondb_owner|neon_superuser|cloud_admin|errors ignored|^pg_restore: (error: could not execute query|from TOC entry|Command was)' "$TMP/restore.log" | grep -i error && \
  echo "⚠ راجع الأخطاء أعلاه" || true
cd "$APP" && sudo -u midar node scripts/migrate.js
systemctl start midar
sudo -u postgres psql -d midar -Atc "SELECT 'المدارس: ' || count(*) FROM tenants"
echo "✓ تم نقل البيانات"
