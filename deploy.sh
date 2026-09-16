#!/bin/bash
# TeamTracker Production Deploy
#
# First install:
#   bash deploy.sh
#
# Update:
#   bash deploy.sh
#
# Production:
#   https://tracker.hostly-eg.com

set -Eeuo pipefail

APP_DIR="/opt/teamtracker"
ADMIN_DIR="$APP_DIR/admin"

REPO_SSH="git@github.com:hamdymohamedak/TeamTracker.git"
BRANCH="main"

DOMAIN="tracker.hostly-eg.com"
PORT="3001"

echo ""
echo "========================================="
echo "  TeamTracker SaaS — Production Deploy"
echo "========================================="
echo ""

# -----------------------------------------
# Helpers
# -----------------------------------------

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

fail() {
    echo ""
    echo " ERROR: $1"
    echo ""
    exit 1
}

# -----------------------------------------
# 1. Check root
# -----------------------------------------

if [ "$(id -u)" -ne 0 ]; then
    fail "This script must be run as root."
fi

# -----------------------------------------
# 2. Install Node.js if missing
# -----------------------------------------

if ! command -v node >/dev/null 2>&1; then
    log "Installing Node.js 20..."

    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

log "Node.js: $(node -v)"
log "npm: $(npm -v)"

# -----------------------------------------
# 3. Install Git if missing
# -----------------------------------------

if ! command -v git >/dev/null 2>&1; then
    log "Installing Git..."

    apt-get update
    apt-get install -y git
fi

log "Git: $(git --version)"

# -----------------------------------------
# 4. Install PM2 if missing
# -----------------------------------------

if ! command -v pm2 >/dev/null 2>&1; then
    log "Installing PM2..."

    npm install -g pm2
fi

log "PM2: $(pm2 -v)"

# -----------------------------------------
# 5. Clone or update repository
# -----------------------------------------

if [ ! -d "$APP_DIR/.git" ]; then

    log "TeamTracker repository not found."
    log "Cloning from GitHub..."

    mkdir -p "$(dirname "$APP_DIR")"

    git clone \
        --branch "$BRANCH" \
        "$REPO_SSH" \
        "$APP_DIR"

else

    log "Existing TeamTracker repository found."
    log "Updating repository..."

    cd "$APP_DIR"

    git fetch origin "$BRANCH"

    git reset --hard "origin/$BRANCH"

fi

cd "$APP_DIR"

log "Current commit: $(git rev-parse --short HEAD)"

# -----------------------------------------
# 6. Create .env if missing
# -----------------------------------------

if [ ! -f "$ADMIN_DIR/.env" ]; then

    log "Creating production .env..."

    mkdir -p "$ADMIN_DIR/data"
    mkdir -p "$ADMIN_DIR/data/uploads"

    JWT_SECRET=$(openssl rand -hex 32)

    cat > "$ADMIN_DIR/.env" << ENVEOF
DATABASE_PATH=./data/admin.db
PORT=3001
NODE_ENV=production
JWT_SECRET=$JWT_SECRET
WS_HEARTBEAT_INTERVAL=30000
ENVEOF

    chmod 600 "$ADMIN_DIR/.env"

    log "Production .env created."

else

    log "Existing .env found."
    log "Keeping current environment configuration."

fi

# -----------------------------------------
# 7. Create data directories
# -----------------------------------------

mkdir -p "$ADMIN_DIR/data"
mkdir -p "$ADMIN_DIR/data/uploads"

# -----------------------------------------
# 8. Install dependencies
# -----------------------------------------

cd "$APP_DIR"

log "Installing project dependencies..."

npm install

# -----------------------------------------
# 9. Fix Rollup Linux native dependency
# -----------------------------------------
#
# npm can sometimes skip Rollup's optional
# Linux native dependency.
#
# We install it without modifying
# package.json or package-lock.json.

log "Ensuring Rollup Linux native dependency..."

npm install \
    --no-save \
    --package-lock=false \
    "@rollup/rollup-linux-x64-gnu@4.59.0"

# -----------------------------------------
# 10. Build application
# -----------------------------------------

cd "$ADMIN_DIR"

log "Building TeamTracker..."

npm run build

log "Build completed successfully."

# -----------------------------------------
# 11. Install nginx if missing
# -----------------------------------------

if ! command -v nginx >/dev/null 2>&1; then

    log "Installing nginx..."

    apt-get update
    apt-get install -y nginx

fi

# -----------------------------------------
# 12. Configure nginx
# -----------------------------------------

NGINX_CONFIG="/etc/nginx/sites-available/tracker.hostly-eg.com.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/tracker.hostly-eg.com.conf"

if [ ! -f "$NGINX_CONFIG" ]; then

    log "Creating nginx configuration..."

    cat > "$NGINX_CONFIG" << 'NGINXEOF'
server {
    listen 80;
    listen [::]:80;

    server_name tracker.hostly-eg.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3001;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
NGINXEOF

else

    log "Existing nginx configuration found."
    log "Keeping existing configuration to preserve SSL/Certbot settings."

fi

ln -sfn \
    "$NGINX_CONFIG" \
    "$NGINX_ENABLED"

# -----------------------------------------
# 13. Validate nginx
# -----------------------------------------

log "Testing nginx configuration..."

if ! nginx -t; then
    fail "Nginx configuration test failed. Nginx was NOT reloaded."
fi

systemctl reload nginx

log "Nginx reloaded successfully."

# -----------------------------------------
# 14. Start / restart PM2
# -----------------------------------------

cd "$ADMIN_DIR"

if pm2 describe teamtracker >/dev/null 2>&1; then

    log "Restarting TeamTracker with PM2..."

    pm2 restart teamtracker

else

    log "Starting TeamTracker with PM2..."

    pm2 start dist/server/index.js \
        --name teamtracker \
        --cwd "$ADMIN_DIR"

fi

# -----------------------------------------
# 15. Save PM2 process list
# -----------------------------------------

pm2 save

log "PM2 process list saved."

# -----------------------------------------
# 16. Ensure PM2 startup
# -----------------------------------------

pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# -----------------------------------------
# 17. Wait for application
# -----------------------------------------

log "Waiting for application to start..."

sleep 3

# -----------------------------------------
# 18. Local health check
# -----------------------------------------

log "Checking application health..."

HEALTH_RESPONSE=$(curl -fsS \
    "http://127.0.0.1:${PORT}/api/health" \
    2>/dev/null) || fail "Application health check failed."

echo ""
echo "Health response:"
echo "$HEALTH_RESPONSE"
echo ""

# -----------------------------------------
# 19. HTTPS health check
# -----------------------------------------

log "Checking HTTPS endpoint..."

if curl -fsS \
    "https://${DOMAIN}/api/health" \
    >/dev/null 2>&1; then

    log "HTTPS endpoint is healthy."

else

    log "WARNING: HTTPS endpoint check failed."
    log "The local application is healthy, but check DNS/SSL/nginx if needed."

fi

# -----------------------------------------
# 20. Final status
# -----------------------------------------

echo ""
echo "========================================="
echo "  ✅ TeamTracker deployed successfully"
echo "========================================="
echo ""
echo "  Dashboard:"
echo "  https://${DOMAIN}"
echo ""
echo "  Health:"
echo "  https://${DOMAIN}/api/health"
echo ""
echo "  Commit:"
echo "  $(git rev-parse --short HEAD)"
echo ""
echo "  PM2:"
echo "  pm2 status"
echo ""
echo "  Logs:"
echo "  pm2 logs teamtracker"
echo ""
echo "========================================="
echo ""