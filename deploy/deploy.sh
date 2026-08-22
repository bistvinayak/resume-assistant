#!/bin/bash
# Deploy Arjun to EC2
# Usage: bash deploy/deploy.sh
# Requires: EC2_HOST and EC2_KEY env vars (or edit defaults below)

set -euo pipefail

EC2_HOST="${EC2_HOST:-ec2-user@YOUR_EC2_IP}"
EC2_KEY="${EC2_KEY:-~/.ssh/arjun-ec2.pem}"
APP_DIR="/home/ec2-user/arjun"

echo "=== Building frontend ==="
cd resumeai-frontend
npm run build
cd ..

echo "=== Syncing to EC2 ==="
rsync -avz --delete \
  -e "ssh -i $EC2_KEY -o StrictHostKeyChecking=no" \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'deploy' \
  --exclude 'logs' \
  --exclude 'resumeai-frontend/node_modules' \
  ./ "$EC2_HOST:$APP_DIR/"

echo "=== Installing dependencies & restarting ==="
ssh -i "$EC2_KEY" "$EC2_HOST" << 'REMOTE'
  cd /home/ec2-user/arjun
  mkdir -p logs
  npm ci --omit=dev

  # Set Puppeteer to use system Chromium
  export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
  export PUPPETEER_EXECUTABLE_PATH=$(which chromium-browser 2>/dev/null || which chromium 2>/dev/null)

  # Restart with PM2
  pm2 startOrRestart deploy/ecosystem.config.js --update-env
  pm2 save

  echo ""
  echo "=== Deploy complete ==="
  pm2 status
REMOTE
