#!/usr/bin/env bash
# تحديث مدار على السيرفر إلى آخر نسخة من main: نسخة احتياطية ← الكود ← الترحيلات ← إعادة التشغيل
#   sudo /opt/midar/deploy/update.sh
set -euo pipefail
APP=/opt/midar; BRANCH="${BRANCH:-main}"
cd "$APP"
"$APP/deploy/backup.sh"
git config --global --add safe.directory "$APP" 2>/dev/null || true
git fetch -q origin "$BRANCH"
git reset -q --hard "origin/$BRANCH"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R midar:midar "$APP"; chmod 600 "$APP/.env"
sudo -u midar node scripts/migrate.js
systemctl restart midar
for _ in $(seq 1 30); do curl -fs http://127.0.0.1:3000/healthz >/dev/null && { echo "✓ تم التحديث: $(git log --oneline -1)"; exit 0; }; sleep 1; done
journalctl -u midar -n 40 --no-pager
echo "✗ الخدمة لم تبدأ بعد التحديث (السجل أعلاه). النسخة الاحتياطية في /var/backups/midar" >&2
exit 1
