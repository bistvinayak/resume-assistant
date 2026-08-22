#!/bin/bash
# One-time EC2 setup script — run on a fresh Amazon Linux 2023 / Ubuntu 22.04 t2.micro
# Usage: ssh into EC2, then: bash ec2-setup.sh

set -euo pipefail

echo "=== Arjun EC2 Setup ==="

# Detect OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS=$ID
else
  OS="unknown"
fi

echo "Detected OS: $OS"

# --- Node.js 18 ---
echo "=== Installing Node.js 18 ==="
if [ "$OS" = "amzn" ]; then
  curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
  sudo yum install -y nodejs
elif [ "$OS" = "ubuntu" ]; then
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v && npm -v

# --- PostgreSQL 15 ---
echo "=== Installing PostgreSQL 15 ==="
if [ "$OS" = "amzn" ]; then
  sudo yum install -y postgresql15-server postgresql15
  sudo postgresql-setup --initdb
  sudo systemctl start postgresql
  sudo systemctl enable postgresql
elif [ "$OS" = "ubuntu" ]; then
  sudo apt-get install -y postgresql postgresql-contrib
  sudo systemctl start postgresql
  sudo systemctl enable postgresql
fi

# Create DB and user
echo "=== Setting up database ==="
sudo -u postgres psql -c "CREATE USER arjun WITH PASSWORD 'arjun_secure_pw_change_me';" 2>/dev/null || echo "User already exists"
sudo -u postgres psql -c "CREATE DATABASE arjun_db OWNER arjun;" 2>/dev/null || echo "DB already exists"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE arjun_db TO arjun;"

# Allow password auth for local connections
PG_HBA=$(sudo -u postgres psql -t -c "SHOW hba_file;" | xargs)
if ! grep -q "arjun" "$PG_HBA" 2>/dev/null; then
  sudo sed -i '/^local.*all.*all/s/peer/md5/' "$PG_HBA"
  sudo systemctl restart postgresql
fi

echo "Database URL: postgresql://arjun:arjun_secure_pw_change_me@localhost:5432/arjun_db"

# --- Nginx ---
echo "=== Installing Nginx ==="
if [ "$OS" = "amzn" ]; then
  sudo yum install -y nginx
elif [ "$OS" = "ubuntu" ]; then
  sudo apt-get install -y nginx
fi
sudo systemctl start nginx
sudo systemctl enable nginx

# --- PM2 ---
echo "=== Installing PM2 ==="
sudo npm install -g pm2

# --- Chromium for Puppeteer ---
echo "=== Installing Chromium dependencies ==="
if [ "$OS" = "amzn" ]; then
  sudo yum install -y chromium nss atk cups-libs libdrm libXcomposite \
    libXdamage libXrandr mesa-libgbm pango alsa-lib
elif [ "$OS" = "ubuntu" ]; then
  sudo apt-get install -y chromium-browser libnss3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libasound2
fi

# --- App directory ---
echo "=== Creating app directory ==="
sudo mkdir -p /home/ec2-user/arjun
sudo chown ec2-user:ec2-user /home/ec2-user/arjun

# --- Git ---
echo "=== Installing Git ==="
if [ "$OS" = "amzn" ]; then
  sudo yum install -y git
elif [ "$OS" = "ubuntu" ]; then
  sudo apt-get install -y git
fi

# --- Swap (t2.micro has 1GB RAM — add 1GB swap) ---
echo "=== Adding swap space ==="
if [ ! -f /swapfile ]; then
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  echo "1GB swap added"
else
  echo "Swap already exists"
fi

# --- PM2 startup on boot ---
pm2 startup systemd -u ec2-user --hp /home/ec2-user | tail -1 | sudo bash

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Copy nginx config:  sudo cp deploy/nginx.conf /etc/nginx/conf.d/arjun.conf"
echo "  2. Create .env file:   cp deploy/.env.template .env  (fill in values)"
echo "  3. Deploy app:         bash deploy/deploy.sh"
echo "  4. Reload nginx:       sudo nginx -t && sudo systemctl reload nginx"
