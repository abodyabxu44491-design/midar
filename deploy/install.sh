#!/usr/bin/env bash
# =====================================================================
# مدار | MIDAR — تجهيز سيرفر جديد بأمر واحد (Ubuntu 24.04)
#
#   curl -fsSL https://raw.githubusercontent.com/abodyabxu44491-design/midar/main/deploy/install.sh -o install.sh
#   sudo bash install.sh midar.example.com you@example.com
#
# يثبّت: Node 22 + PostgreSQL + nginx + شهادة HTTPS + جدار حماية + تحديثات أمنية تلقائية
#        + نسخة احتياطية يومية مشفرة + خدمة دائمة تعود وحدها بعد أي إعادة تشغيل.
# يُعاد تشغيله بأمان: ما جُهّز من قبل لا يُعاد (كلمات المرور وقاعدة البيانات تبقى كما هي).
# متغيرات اختيارية: REPO (رابط المستودع)، BRANCH (main)، OWNER_USERNAME، OWNER_PASSWORD، SKIP_TLS=1
# =====================================================================
set -euo pipefail

DOMAIN="${1:-}"; EMAIL="${2:-}"
REPO="${REPO:-https://github.com/abodyabxu44491-design/midar.git}"
BRANCH="${BRANCH:-main}"
APP=/opt/midar; ENVF=$APP/.env; CREDS=/root/midar-credentials.txt
say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "شغّله بصلاحية المدير: sudo bash install.sh النطاق البريد"
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || die "الاستخدام: sudo bash install.sh midar.example.com you@example.com"
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "النطاق غير صحيح: $DOMAIN"
export DEBIAN_FRONTEND=noninteractive
rand() { openssl rand -hex "${1:-24}"; }

say "1/9 تحديث النظام والأدوات الأساسية"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg ufw nginx certbot python3-certbot-nginx \
  postgresql postgresql-contrib unattended-upgrades fail2ban >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null || true

say "2/9 ذاكرة احتياطية (swap) للسيرفرات الصغيرة"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "3/9 Node.js 22"
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

say "4/9 الكود"
git config --global --add safe.directory "$APP" 2>/dev/null || true
id midar >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin midar
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch -q origin "$BRANCH" && git -C "$APP" checkout -q "$BRANCH" && git -C "$APP" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP" || die "تعذر تنزيل المستودع. إن كان خاصًا: REPO=https://TOKEN@github.com/USER/midar.git"
fi
cd "$APP"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

say "5/9 قاعدة البيانات (على نفس السيرفر، لا تُفتح للإنترنت)"
# ضبط مناسب لسيرفر 4 جيجابايت
PGCONF=$(sudo -u postgres psql -Atc "SHOW config_file"); PGDIR=$(dirname "$PGCONF")/conf.d
mkdir -p "$PGDIR"
cat > "$PGDIR/midar.conf" <<'EOF'
listen_addresses = 'localhost'
shared_buffers = 512MB
effective_cache_size = 1536MB
work_mem = 8MB
maintenance_work_mem = 128MB
max_connections = 60
EOF
systemctl restart postgresql
if [ -f "$ENVF" ]; then
  APP_PASS=$(grep -oP '^DATABASE_URL=postgres://midar_app:\K[^@]+' "$ENVF")
  OWN_PASS=$(grep -oP '^MIGRATION_DATABASE_URL=postgres://midar_owner:\K[^@]+' "$ENVF")
else
  APP_PASS=$(rand); OWN_PASS=$(rand)
fi
sudo -u postgres psql -q -v ON_ERROR_STOP=1 <<EOF
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'midar_owner') THEN CREATE ROLE midar_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'midar_app') THEN CREATE ROLE midar_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
END \$\$;
ALTER ROLE midar_owner PASSWORD '$OWN_PASS';
ALTER ROLE midar_app PASSWORD '$APP_PASS';
EOF
sudo -u postgres psql -Atc "SELECT 1 FROM pg_database WHERE datname = 'midar'" | grep -q 1 \
  || sudo -u postgres createdb -O midar_owner midar
sudo -u postgres psql -q -d midar -v ON_ERROR_STOP=1 -c "ALTER SCHEMA public OWNER TO midar_owner" -c "GRANT USAGE ON SCHEMA public TO midar_app"

say "6/9 الإعدادات والأسرار"
if [ ! -f "$ENVF" ]; then
  OWNER_USERNAME="${OWNER_USERNAME:-owner}"
  if [ -z "${OWNER_PASSWORD:-}" ]; then
    read -rsp "اكتب كلمة مرور لوحة المالك (12 حرفًا على الأقل): " OWNER_PASSWORD; echo
  fi
  [ "${#OWNER_PASSWORD}" -ge 12 ] || die "كلمة المرور قصيرة"
  HASH=$(node scripts/owner-password.js "$OWNER_PASSWORD" | grep -o 'scrypt\$.*')
  OWNER_PATH="/control-$(rand 10)"
  umask 077
  cat > "$ENVF" <<EOF
NODE_ENV=production
PORT=3000
PUBLIC_URL=https://$DOMAIN
DATABASE_URL=postgres://midar_app:$APP_PASS@127.0.0.1:5432/midar
MIGRATION_DATABASE_URL=postgres://midar_owner:$OWN_PASS@127.0.0.1:5432/midar
DATABASE_SSL=false
OWNER_PATH=$OWNER_PATH
OWNER_USERNAME=$OWNER_USERNAME
OWNER_PASSWORD_HASH=$HASH
CREDENTIAL_KEY=$(rand 32)
COOKIE_SECURE=true
TRUST_PROXY=1
SESSION_COOKIE_MODE=separate
EOF
  cat > "$CREDS" <<EOF
مدار — بيانات لوحة المالك (احفظها في مكان آمن ثم احذف هذا الملف)
الرابط:   https://$DOMAIN$OWNER_PATH
المستخدم: $OWNER_USERNAME
كلمة المرور: التي كتبتها أثناء التثبيت
EOF
  chmod 600 "$CREDS"
else
  sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAIN#" "$ENVF"
fi
chown -R midar:midar "$APP"; chmod 600 "$ENVF"
sudo -u midar node scripts/migrate.js

say "7/9 الخدمة الدائمة"
cp deploy/midar.service /etc/systemd/system/midar.service
systemctl daemon-reload
systemctl enable -q midar
systemctl restart midar
for _ in $(seq 1 30); do curl -fs http://127.0.0.1:3000/healthz >/dev/null && break; sleep 1; done
curl -fs http://127.0.0.1:3000/healthz >/dev/null || { journalctl -u midar -n 40 --no-pager; die "الخدمة لم تبدأ (السجل أعلاه)"; }

say "8/9 nginx + HTTPS + جدار الحماية"
sed "s/midar.example.com/$DOMAIN www.$DOMAIN/" deploy/nginx.conf > /etc/nginx/sites-available/midar
ln -sf /etc/nginx/sites-available/midar /etc/nginx/sites-enabled/midar
rm -f /etc/nginx/sites-enabled/default
nginx -t -q && systemctl reload nginx
ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable >/dev/null
if [ "${SKIP_TLS:-0}" != 1 ]; then
  WWW=""; getent hosts "www.$DOMAIN" >/dev/null && WWW="-d www.$DOMAIN"
  certbot --nginx -n --agree-tos -m "$EMAIL" -d "$DOMAIN" $WWW --redirect \
    || echo "⚠ تعذر إصدار الشهادة: تأكد أن سجل A للنطاق يشير لهذا السيرفر ثم: sudo certbot --nginx -d $DOMAIN --redirect"
fi

say "9/9 النسخ الاحتياطي اليومي المشفّر"
[ -f /root/.midar-backup-key ] || { rand 32 > /root/.midar-backup-key; chmod 600 /root/.midar-backup-key; }
chmod +x deploy/backup.sh deploy/update.sh
echo "17 0 * * * root $APP/deploy/backup.sh >> /var/log/midar-backup.log 2>&1" > /etc/cron.d/midar-backup

printf '\n\033[1;32m✓ مدار يعمل الآن: https://%s\033[0m\n' "$DOMAIN"
[ -f "$CREDS" ] && cat "$CREDS"
echo
echo "مفتاح فك النسخ الاحتياطية: /root/.midar-backup-key  (انسخه عندك؛ بدونه لا تُفتح النسخ)"
echo "التحديث لاحقًا:  sudo /opt/midar/deploy/update.sh"
echo "السجل المباشر:   sudo journalctl -u midar -f"
