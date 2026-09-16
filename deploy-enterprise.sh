#!/bin/bash
# TeamTracker Enterprise / update deploy
# Pulls latest code into APP_DIR, rebuilds, restarts PM2.
# NEVER deletes /var/lib/teamtracker or rm -rf /opt/teamtracker.
#
# Usage (as root on the VPS):
#   bash deploy-enterprise.sh
#
# Optional env:
#   APP_DIR=/opt/teamtracker/application
#   DATA_DIR=/var/lib/teamtracker
#   ENV_FILE=/var/lib/teamtracker/.env
#   BRANCH=main
#   PUBLIC_BASE_URL=https://track.example.com
#   PORT=3001

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_ROOT="${APP_ROOT:-/opt/teamtracker}"
APP_DIR="${APP_DIR:-$APP_ROOT/application}"
DATA_DIR="${DATA_DIR:-/var/lib/teamtracker}"
ENV_FILE="${ENV_FILE:-$DATA_DIR/.env}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3001}"
PM2_NAME="${PM2_NAME:-teamtracker}"

die() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }
ok() { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }

echo "🏢 TeamTracker Enterprise Deploy"
echo "=================================="
echo ""

if [ "$(id -u)" -ne 0 ]; then
  die "Must run as root (use sudo)."
fi

# Resolve application directory (support legacy layouts)
if [ -d "$APP_DIR/.git" ]; then
  :
elif [ -d "$APP_ROOT/application/.git" ]; then
  APP_DIR="$APP_ROOT/application"
elif [ -d "$APP_ROOT/teamtracker/.git" ]; then
  APP_DIR="$APP_ROOT/teamtracker"
  warn "Using legacy path $APP_DIR — prefer /opt/teamtracker/application"
elif [ -d "$APP_ROOT/.git" ]; then
  APP_DIR="$APP_ROOT"
  warn "Using legacy git root $APP_DIR — prefer /opt/teamtracker/application"
else
  die "Cannot find TeamTracker checkout. Run deploy.sh first, or set APP_DIR."
fi

ADMIN_DIR="$APP_DIR/admin"
[ -d "$ADMIN_DIR" ] || die "Missing admin/ under $APP_DIR"

mkdir -p "$DATA_DIR"/{database,uploads,backups}
ok "App: $APP_DIR"
ok "Data: $DATA_DIR"

echo ""
echo "📥 Pulling latest ($BRANCH)..."
cd "$APP_DIR"
git fetch --depth 1 origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH" || warn "ff-only pull failed; using current tree"

# Ensure persistent env exists and is linked
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ADMIN_DIR/.env" ] && [ ! -L "$ADMIN_DIR/.env" ]; then
    cp "$ADMIN_DIR/.env" "$ENV_FILE"
    ok "Copied admin/.env → $ENV_FILE"
  else
    die "Missing $ENV_FILE — run deploy.sh once to create production env."
  fi
fi
chmod 600 "$ENV_FILE"

# Keep path keys correct; never rotate JWT_SECRET
upsert() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}
upsert "DATA_DIR" "$DATA_DIR"
upsert "DATABASE_PATH" "$DATA_DIR/database/admin.db"
upsert "UPLOADS_DIR" "$DATA_DIR/uploads"
upsert "BACKUPS_DIR" "$DATA_DIR/backups"
upsert "NODE_ENV" "production"

if [ -n "${PUBLIC_BASE_URL:-}" ]; then
  upsert "PUBLIC_BASE_URL" "$PUBLIC_BASE_URL"
fi

if [ -L "$ADMIN_DIR/.env" ] || [ ! -e "$ADMIN_DIR/.env" ]; then
  ln -sfn "$ENV_FILE" "$ADMIN_DIR/.env"
elif [ ! -L "$ADMIN_DIR/.env" ]; then
  cp "$ADMIN_DIR/.env" "$ADMIN_DIR/.env.enterprise-bak.$(date +%s)" 2>/dev/null || true
  rm -f "$ADMIN_DIR/.env"
  ln -sfn "$ENV_FILE" "$ADMIN_DIR/.env"
fi
ok "admin/.env → $ENV_FILE"

echo ""
echo "🔨 Building..."
cd "$ADMIN_DIR"
npm install --include=dev
npm run build
ok "Build complete"

echo ""
echo "🔄 Restarting PM2..."
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
# Prefer PORT from env file if set
if grep -qE '^PORT=' "$ENV_FILE"; then
  PORT="$(grep -E '^PORT=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi

pm2 describe "$PM2_NAME" >/dev/null 2>&1 && pm2 restart "$PM2_NAME" --update-env \
  || pm2 start dist/server/index.js --name "$PM2_NAME" --cwd "$ADMIN_DIR" --update-env
pm2 save
ok "PM2 restarted"

echo ""
echo "⏳ Health checks..."
HEALTH_OK=0
READY_OK=0
for i in $(seq 1 30); do
  curl -sf --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && HEALTH_OK=1
  if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/api/ready" >/dev/null 2>&1; then
    READY_OK=1
    break
  fi
  sleep 1
done

[ "$HEALTH_OK" -eq 1 ] || die "/api/health failed — see: pm2 logs $PM2_NAME"
ok "/api/health"
[ "$READY_OK" -eq 1 ] || die "/api/ready failed — DB/storage not ready (data: $DATA_DIR)"
ok "/api/ready"

HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
# Prefer PUBLIC_BASE_URL from env file, then override, then hostname
if [ -z "${PUBLIC_BASE_URL:-}" ] && grep -qE '^PUBLIC_BASE_URL=' "$ENV_FILE"; then
  PUBLIC_BASE_URL="$(grep -E '^PUBLIC_BASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
PUBLIC_HINT="${PUBLIC_BASE_URL:-http://${HOSTNAME_FQDN}}"

echo ""
echo "=================================="
echo -e "${GREEN}✓ Deployment complete${NC}"
echo "Dashboard: $PUBLIC_HINT"
echo "Health:    $PUBLIC_HINT/api/health"
echo "Ready:     $PUBLIC_HINT/api/ready"
echo "=================================="
