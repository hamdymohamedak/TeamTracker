#!/bin/bash
# TeamTracker Production Deploy (first install + update)
#
# Layout:
#   /opt/teamtracker/application/   — git checkout (safe to replace)
#   /var/lib/teamtracker/           — persistent data (NEVER wiped)
#
# Usage (as root):
#   bash deploy.sh
#   # or after clone:
#   bash /opt/teamtracker/application/deploy.sh
#
# Optional env: APP_ROOT, APP_DIR, DATA_DIR, ENV_FILE, BRANCH, PORT, DOMAIN, PUBLIC_BASE_URL, REPO_SSH

set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/teamtracker}"
APP_DIR="${APP_DIR:-$APP_ROOT/application}"
DATA_DIR="${DATA_DIR:-/var/lib/teamtracker}"
ENV_FILE="${ENV_FILE:-$DATA_DIR/.env}"
REPO_SSH="${REPO_SSH:-git@github.com:hamdymohamedak/TeamTracker.git}"
REPO_HTTPS="${REPO_HTTPS:-https://github.com/hamdymohamedak/TeamTracker.git}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-tracker.hostly-eg.com}"
PORT="${PORT:-3001}"
PM2_NAME="${PM2_NAME:-teamtracker}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://${DOMAIN}}"

echo ""
echo "========================================="
echo "  TeamTracker — Production Deploy"
echo "========================================="
echo ""

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }
fail() { echo ""; echo " ERROR: $1"; echo ""; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  fail "This script must be run as root."
fi

# -----------------------------------------
# Resolve existing checkout (legacy-friendly)
# -----------------------------------------
resolve_app_dir() {
  if [ -d "$APP_DIR/.git" ]; then
    return 0
  fi
  if [ -d "$APP_ROOT/application/.git" ]; then
    APP_DIR="$APP_ROOT/application"
    return 0
  fi
  if [ -d "$APP_ROOT/.git" ] && [ -d "$APP_ROOT/admin" ]; then
    # Legacy: repo cloned directly at /opt/teamtracker
    APP_DIR="$APP_ROOT"
    log "Using legacy checkout at $APP_DIR (prefer $APP_ROOT/application going forward)"
    return 0
  fi
  if [ -d "$APP_ROOT/teamtracker/.git" ]; then
    APP_DIR="$APP_ROOT/teamtracker"
    return 0
  fi
  return 1
}

# -----------------------------------------
# Dependencies
# -----------------------------------------
if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
log "Node.js: $(node -v)"

if ! command -v git >/dev/null 2>&1; then
  log "Installing Git..."
  apt-get update
  apt-get install -y git
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing PM2..."
  npm install -g pm2
fi

if ! command -v openssl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y openssl
fi

# -----------------------------------------
# Clone or update
# -----------------------------------------
if resolve_app_dir; then
  log "Updating repository at $APP_DIR..."
  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH" >/dev/null 2>&1 || true
  git reset --hard "origin/$BRANCH"
else
  log "Cloning into $APP_DIR..."
  mkdir -p "$(dirname "$APP_DIR")"
  if ! git clone --branch "$BRANCH" "$REPO_SSH" "$APP_DIR" 2>/dev/null; then
    log "SSH clone failed — trying HTTPS..."
    git clone --branch "$BRANCH" "$REPO_HTTPS" "$APP_DIR" || fail "git clone failed"
  fi
fi

cd "$APP_DIR"
ADMIN_DIR="$APP_DIR/admin"
[ -d "$ADMIN_DIR" ] || fail "Missing admin/ under $APP_DIR"
log "Current commit: $(git rev-parse --short HEAD)"

# Load shared helpers from the checkout we just updated
# shellcheck disable=SC1091
source "$APP_DIR/scripts/deploy-lib.sh"

tt_ensure_data_dirs "$DATA_DIR"
tt_ensure_production_env "$ENV_FILE"
tt_migrate_legacy_database
tt_migrate_legacy_uploads

# -----------------------------------------
# Build
# -----------------------------------------
log "Installing dependencies and building admin..."
tt_npm_install_and_build_admin "$APP_DIR" "$ADMIN_DIR"
log "Build completed."

# -----------------------------------------
# nginx
# -----------------------------------------
if ! command -v nginx >/dev/null 2>&1; then
  log "Installing nginx..."
  apt-get update
  apt-get install -y nginx
fi

NGINX_CONFIG="/etc/nginx/sites-available/${DOMAIN}.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}.conf"

if [ ! -f "$NGINX_CONFIG" ]; then
  log "Creating nginx configuration..."
  cat > "$NGINX_CONFIG" << NGINXEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
NGINXEOF
else
  log "Keeping existing nginx config (preserves SSL/Certbot)."
fi

ln -sfn "$NGINX_CONFIG" "$NGINX_ENABLED"

log "Testing nginx..."
nginx -t || fail "Nginx configuration test failed."
systemctl reload nginx

# -----------------------------------------
# PM2 (load env so DATABASE_PATH / JWT_SECRET apply)
# -----------------------------------------
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

cd "$ADMIN_DIR"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  log "Restarting PM2 ($PM2_NAME)..."
  pm2 restart "$PM2_NAME" --update-env
else
  log "Starting PM2 ($PM2_NAME)..."
  pm2 start dist/server/index.js --name "$PM2_NAME" --cwd "$ADMIN_DIR" --update-env
fi
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# -----------------------------------------
# Health
# -----------------------------------------
log "Waiting for application..."
HEALTH_OK=0
READY_OK=0
for _ in $(seq 1 30); do
  curl -sf --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && HEALTH_OK=1
  if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/api/ready" >/dev/null 2>&1; then
    READY_OK=1
    break
  fi
  sleep 1
done

[ "$HEALTH_OK" -eq 1 ] || fail "Local /api/health failed — see: pm2 logs $PM2_NAME"
[ "$READY_OK" -eq 1 ] || fail "Local /api/ready failed — check DATABASE_PATH under $DATA_DIR"

if curl -fsS "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
  log "HTTPS endpoint is healthy."
else
  log "WARNING: HTTPS check failed (DNS/SSL may still be pending)."
fi

echo ""
echo "========================================="
echo "  TeamTracker deployed successfully"
echo "========================================="
echo ""
echo "  Dashboard:  https://${DOMAIN}"
echo "  Health:     https://${DOMAIN}/api/health"
echo "  Data dir:   ${DATA_DIR}"
echo "  Env file:   ${ENV_FILE}"
echo "  App code:   ${APP_DIR}"
echo "  Commit:     $(git -C "$APP_DIR" rev-parse --short HEAD)"
echo ""
echo "  pm2 status | pm2 logs $PM2_NAME"
echo "========================================="
echo ""
