#!/bin/bash
# Migrate PostgreSQL data from Railway to EC2
# Usage: bash deploy/migrate-db.sh
#
# Step 1: Export from Railway (run from your local machine)
# Step 2: Import to EC2

set -euo pipefail

DUMP_FILE="arjun_railway_dump.sql"

echo "=== Step 1: Export from Railway ==="
echo "Paste your Railway DATABASE_URL (postgresql://...):"
read -r RAILWAY_DB_URL

echo "Dumping Railway database..."
pg_dump "$RAILWAY_DB_URL" --no-owner --no-acl --clean --if-exists > "$DUMP_FILE"
echo "Exported to $DUMP_FILE ($(du -h $DUMP_FILE | cut -f1))"

echo ""
echo "=== Step 2: Import to EC2 ==="

EC2_HOST="${EC2_HOST:-ec2-user@YOUR_EC2_IP}"
EC2_KEY="${EC2_KEY:-~/.ssh/arjun-ec2.pem}"

echo "Copying dump to EC2..."
scp -i "$EC2_KEY" "$DUMP_FILE" "$EC2_HOST:/tmp/"

echo "Importing on EC2..."
ssh -i "$EC2_KEY" "$EC2_HOST" << 'REMOTE'
  sudo -u postgres psql arjun_db < /tmp/arjun_railway_dump.sql
  rm /tmp/arjun_railway_dump.sql
  echo "Import complete"
  sudo -u postgres psql arjun_db -c "\dt"
REMOTE

rm "$DUMP_FILE"
echo "=== Migration done ==="
