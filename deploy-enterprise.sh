#!/bin/bash
# TeamTracker Enterprise / update deploy
# Pulls latest code into APP_DIR, rebuilds, restarts PM2.
# NEVER deletes /var/lib/teamtracker. NEVER rotates JWT_SECRET if present.
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
elif [ -d "$APP_ROOT/.git" ] && [ -d "$APP_ROOT/admin" ]; then
  APP_DIR="$APP_ROOT"
  warn "Using legacy git root $APP_DIR — prefer /opt/teamtracker/application"
else
  die "Cannot find TeamTracker checkout. Run deploy.sh first, or set APP_DIR."
fi

ADMIN_DIR="$APP_DIR/admin"
[ -d "$ADMIN_DIR" ] || die "Missing admin/ under $APP_DIR"
[ -f "$APP_DIR/scripts/deploy-lib.sh" ] || die "Missing scripts/deploy-lib.sh — pull latest code"

# shellcheck disable=SC1091
source "$APP_DIR/scripts/deploy-lib.sh"

ok "App: $APP_DIR"
ok "Data: $DATA_DIR"

echo ""
echo "📥 Pulling latest ($BRANCH)..."
cd "$APP_DIR"
git fetch --depth 1 origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH" || warn "ff-only pull failed; using current tree"

# Re-source after pull in case helpers updated
# shellcheck disable=SC1091
source "$APP_DIR/scripts/deploy-lib.sh"

tt_ensure_data_dirs "$DATA_DIR"
# Migrate BEFORE rewriting DATABASE_PATH so we don't open an empty DB
tt_migrate_legacy_database
tt_migrate_legacy_uploads
tt_ensure_production_env "$ENV_FILE"

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
if grep -qE '^PORT=' "$ENV_FILE"; then
  PORT="$(tt_env_get "$ENV_FILE" PORT)"
  PORT="${PORT:-3001}"
fi

pm2 describe "$PM2_NAME" >/dev/null 2>&1 && pm2 restart "$PM2_NAME" --update-env \
  || pm2 start dist/server/index.js --name "$PM2_NAME" --cwd "$ADMIN_DIR" --update-env
pm2 save
ok "PM2 restarted"

echo ""
echo "⏳ Health checks..."
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

[ "$HEALTH_OK" -eq 1 ] || {
  echo "----- pm2 logs $PM2_NAME (last 80 lines) -----" >&2
  pm2 logs "$PM2_NAME" --lines 80 --nostream >&2 || true
  die "/api/health failed — see pm2 logs above"
}
ok "/api/health"
[ "$READY_OK" -eq 1 ] || die "/api/ready failed — DB/storage not ready (data: $DATA_DIR)"
ok "/api/ready"

HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
if [ -z "${PUBLIC_BASE_URL:-}" ]; then
  PUBLIC_BASE_URL="$(tt_env_get "$ENV_FILE" PUBLIC_BASE_URL)"
fi
PUBLIC_HINT="${PUBLIC_BASE_URL:-http://${HOSTNAME_FQDN}}"

echo ""
echo "=================================="
echo -e "${GREEN}✓ Deployment complete${NC}"
echo "Dashboard: $PUBLIC_HINT"
echo "Health:    $PUBLIC_HINT/api/health"
echo "Ready:     $PUBLIC_HINT/api/ready"
echo "Data:      $DATA_DIR"
echo "=================================="
