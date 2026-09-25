#!/bin/bash
# Nightly Arjun database backup: compressed pg_dump into ~/backups, 7 days kept.
# Run by src/cron.js (the EC2 host has no crontab). Added 2026-09-25 after profiles were
# lost to an admin delete with no backup to restore from.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${BACKUP_DIR:-$HOME/backups}"
mkdir -p "$DIR"
DB_URL=$(grep '^DATABASE_URL=' "$APP_DIR/.env" | cut -d= -f2-)
OUT="$DIR/arjun-$(date +%Y%m%d-%H%M).sql.gz"
pg_dump --no-owner --no-privileges "$DB_URL" | gzip > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
find "$DIR" -name 'arjun-*.sql.gz' -mtime +7 -delete
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
