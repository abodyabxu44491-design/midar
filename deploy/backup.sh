#!/usr/bin/env bash
# (سيرفر خاص) نسخة احتياطية يومية مشفرة من قاعدة البيانات
# cron: 0 3 * * * /opt/midar/deploy/backup.sh
set -euo pipefail
DIR=/var/backups/midar
mkdir -p "$DIR"
FILE="$DIR/midar-$(date +%F-%H%M).dump"
sudo -u postgres pg_dump -Fc midar > "$FILE"
gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file /root/.midar-backup-key "$FILE" && rm "$FILE"
find "$DIR" -name '*.gpg' -mtime +30 -delete
echo "✓ $FILE.gpg"
# الاسترجاع: gpg -d FILE.gpg > x.dump && pg_restore -d midar_restore x.dump
