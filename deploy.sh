#!/bin/bash
# TeamTracker production-safe single-VPS deploy
# Persistent data lives under /var/lib/teamtracker and is NEVER wiped by this script.
#
# Usage (on the VPS as root):
#   curl -sSL https://raw.githubusercontent.com/hamdymohamedak/TeamTracker/main/deploy.sh | bash
# Or:
#   bash deploy.sh
#
# Optional env overrides:
#   APP_DIR=/opt/teamtracker/application
#   DATA_DIR=/var/lib/teamtracker
#   ENV_FILE=/var/lib/teamtracker/.env
#   REPO_URL=https://github.com/hamdymohamedak/TeamTracker.git
#   BRANCH=main
#   PUBLIC_BASE_URL=https://track.example.com
#   PORT=3001
#   MIN_DISK_MB=512

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_ROOT="${APP_ROOT:-/opt/teamtracker}"
APP_DIR="${APP_DIR:-$APP_ROOT/application}"
DATA_DIR="${DATA_DIR:-/var/lib/teamtracker}"
ENV_FILE="${ENV_FILE:-$DATA_DIR/.env}"
REPO_URL="${REPO_URL:-https://github.com/hamdymohamedak/TeamTracker.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3001}"
MIN_DISK_MB="${MIN_DISK_MB:-512}"
PM2_NAME="${PM2_NAME:-teamtracker}"

echo ""
echo "========================================="
echo "  TeamTracker — Production Deploy"
echo "========================================="
echo ""

die() {
  echo -e "${RED}✗${NC} $*" >&2
  exit 1
}

ok() { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
if [ "$(id -u)" -ne 0 ]; then
  die "Must run as root (use sudo)."
fi
ok "Running as root"

if ! command -v node >/dev/null 2>&1; then
  echo "📦 Installing Node.js 20..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    die "Node.js is required. Install Node 20+ and re-run."
  fi
fi

NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [ "${NODE_MAJOR}" -lt 18 ]; then
  die "Node.js 18+ required (found $(node -v))."
fi
ok "Node.js $(node -v)"

if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y git
  else
    die "git is required."
  fi
fi
ok "git available"

# Disk check on data volume (or /)
DISK_TARGET="$DATA_DIR"
[ -d "$DISK_TARGET" ] || DISK_TARGET="/"
AVAIL_MB="$(df -Pm "$DISK_TARGET" | awk 'NR==2 {print $4}')"
if [ -z "$AVAIL_MB" ] || [ "$AVAIL_MB" -lt "$MIN_DISK_MB" ]; then
  die "Insufficient disk space under $DISK_TARGET (need ≥${MIN_DISK_MB}MB free, found ${AVAIL_MB:-unknown}MB)."
fi
ok "Disk space OK (${AVAIL_MB}MB free)"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "📦 Installing PM2..."
  npm install -g pm2
fi
ok "PM2 available"

# ---------------------------------------------------------------------------
# 2. Create directories (never wipe DATA_DIR)
# ---------------------------------------------------------------------------
# Safety: never rm -rf APP_ROOT or DATA_DIR
mkdir -p "$APP_DIR"
mkdir -p "$DATA_DIR"/{database,uploads,backups}
chmod 750 "$DATA_DIR" "$DATA_DIR"/database "$DATA_DIR"/uploads "$DATA_DIR"/backups
ok "Dirs ready: $APP_DIR + $DATA_DIR/{database,uploads,backups}"

# ---------------------------------------------------------------------------
# 3. Clone / pull application code only
# ---------------------------------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  echo "📥 Updating existing checkout in $APP_DIR..."
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH" || \
    warn "git pull --ff-only failed; continuing with current checkout"
else
  # Migrate legacy layout: /opt/teamtracker was the git root
  if [ -d "$APP_ROOT/.git" ] && [ ! -d "$APP_DIR/.git" ]; then
    echo "📦 Migrating legacy checkout $APP_ROOT → $APP_DIR..."
    # Move code aside without touching any data under /var/lib
    mkdir -p "$(dirname "$APP_DIR")"
    # If APP_DIR is inside APP_ROOT, restructure carefully
    if [ "$APP_DIR" = "$APP_ROOT/application" ]; then
      TMP_MOVE="$(mktemp -d /tmp/teamtracker-migrate.XXXXXX)"
      # Move everything except 'application' into temp, then into APP_DIR
      shopt -s dotglob nullglob
      for item in "$APP_ROOT"/*; do
        base="$(basename "$item")"
        if [ "$base" = "application" ]; then
          continue
        fi
        mv "$item" "$TMP_MOVE/"
      done
      shopt -u dotglob nullglob
      mkdir -p "$APP_DIR"
      mv "$TMP_MOVE"/* "$APP_DIR"/ 2>/dev/null || true
      # also move hidden files
      shopt -s dotglob nullglob
      for item in "$TMP_MOVE"/.*; do
        [ -e "$item" ] || continue
        base="$(basename "$item")"
        [ "$base" = "." ] || [ "$base" = ".." ] && continue
        mv "$item" "$APP_DIR/"
      done
      shopt -u dotglob nullglob
      rmdir "$TMP_MOVE" 2>/dev/null || rm -rf "$TMP_MOVE"
      ok "Legacy git tree moved to $APP_DIR"
    else
      git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
    fi
  else
    echo "📥 Cloning into $APP_DIR..."
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
fi
ok "Application code at $APP_DIR"

ADMIN_DIR="$APP_DIR/admin"
[ -d "$ADMIN_DIR" ] || die "Expected admin/ under $APP_DIR"

# ---------------------------------------------------------------------------
# 4. Preserve / create persistent .env
# ---------------------------------------------------------------------------
ensure_env_kv() {
  local key="$1"
  local value="$2"
  local file="$3"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    # Update in place only for path/layout keys we own
    if [[ "$key" =~ ^(DATA_DIR|DATABASE_PATH|UPLOADS_DIR|BACKUPS_DIR|NODE_ENV)$ ]]; then
      sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
      rm -f "${file}.bak"
    fi
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  # Prefer existing admin/.env if present (upgrade path)
  if [ -f "$ADMIN_DIR/.env" ] && [ ! -L "$ADMIN_DIR/.env" ]; then
    echo "📋 Seeding $ENV_FILE from existing admin/.env..."
    cp "$ADMIN_DIR/.env" "$ENV_FILE"
  else
    JWT_SECRET="$(openssl rand -hex 32)"
    HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
    PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://${HOSTNAME_FQDN}}"
    cat > "$ENV_FILE" << ENVEOF
# TeamTracker production environment (persistent — do not store under application/)
NODE_ENV=production
PORT=${PORT}

DATA_DIR=${DATA_DIR}
DATABASE_PATH=${DATA_DIR}/database/admin.db
UPLOADS_DIR=${DATA_DIR}/uploads
BACKUPS_DIR=${DATA_DIR}/backups

# IMPORTANT: Do not change JWT_SECRET after users/devices enroll — tokens invalidate.
JWT_SECRET=${JWT_SECRET}

PUBLIC_BASE_URL=${PUBLIC_BASE_URL}

# Optional
# DEEPSEEK_API_KEY=
# CORS_ORIGIN=
# SCREENSHOT_RETENTION_DAYS=30
# BACKUP_ENABLED=1
# BACKUP_INTERVAL_HOURS=24
# BACKUP_RETENTION_DAYS=14
# RESEND_API_KEY=
# EMAIL_FROM=TeamTracker <noreply@example.com>
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SEED_DEMO_DATA=0
ENVEOF
    ok "Created $ENV_FILE with new JWT_SECRET"
  fi
else
  ok "Keeping existing $ENV_FILE"
fi

chmod 600 "$ENV_FILE"

# Ensure required path keys (never regenerate JWT_SECRET if present)
ensure_env_kv "DATA_DIR" "$DATA_DIR" "$ENV_FILE"
ensure_env_kv "DATABASE_PATH" "$DATA_DIR/database/admin.db" "$ENV_FILE"
ensure_env_kv "UPLOADS_DIR" "$DATA_DIR/uploads" "$ENV_FILE"
ensure_env_kv "BACKUPS_DIR" "$DATA_DIR/backups" "$ENV_FILE"
ensure_env_kv "NODE_ENV" "production" "$ENV_FILE"

if ! grep -qE '^JWT_SECRET=.+' "$ENV_FILE"; then
  JWT_SECRET="$(openssl rand -hex 32)"
  ensure_env_kv "JWT_SECRET" "$JWT_SECRET" "$ENV_FILE"
  ok "Generated missing JWT_SECRET"
else
  ok "JWT_SECRET preserved"
fi

if [ -n "${PUBLIC_BASE_URL:-}" ]; then
  if grep -qE '^PUBLIC_BASE_URL=' "$ENV_FILE"; then
    sed -i.bak "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=${PUBLIC_BASE_URL}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf '\nPUBLIC_BASE_URL=%s\n' "$PUBLIC_BASE_URL" >> "$ENV_FILE"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Install + build admin
# ---------------------------------------------------------------------------
cd "$ADMIN_DIR"
echo "📦 Installing admin dependencies..."
npm install --include=dev
echo "🔨 Building admin (server + client)..."
npm run build
ok "Build complete"

# ---------------------------------------------------------------------------
# 6. Symlink admin/.env → persistent env
# ---------------------------------------------------------------------------
if [ -L "$ADMIN_DIR/.env" ] || [ -e "$ADMIN_DIR/.env" ]; then
  if [ -L "$ADMIN_DIR/.env" ]; then
    ln -sfn "$ENV_FILE" "$ADMIN_DIR/.env"
  elif [ "$(readlink -f "$ADMIN_DIR/.env" 2>/dev/null || true)" != "$(readlink -f "$ENV_FILE")" ]; then
    # Real file: back up once, then replace with symlink
    cp "$ADMIN_DIR/.env" "$ADMIN_DIR/.env.deploy-bak.$(date +%s)" 2>/dev/null || true
    rm -f "$ADMIN_DIR/.env"
    ln -sfn "$ENV_FILE" "$ADMIN_DIR/.env"
  fi
else
  ln -sfn "$ENV_FILE" "$ADMIN_DIR/.env"
fi
ok "admin/.env → $ENV_FILE"

# ---------------------------------------------------------------------------
# 7. One-time legacy data migration (never overwrite dest)
# ---------------------------------------------------------------------------
migrate_file() {
  local src="$1"
  local dest="$2"
  if [ -f "$src" ] && [ ! -f "$dest" ]; then
    mkdir -p "$(dirname "$dest")"
    mv "$src" "$dest"
    ok "Migrated $src → $dest"
    # Move WAL/SHM companions if present
    if [ -f "${src}-wal" ] && [ ! -f "${dest}-wal" ]; then mv "${src}-wal" "${dest}-wal"; fi
    if [ -f "${src}-shm" ] && [ ! -f "${dest}-shm" ]; then mv "${src}-shm" "${dest}-shm"; fi
  elif [ -f "$src" ] && [ -f "$dest" ]; then
    warn "Legacy $src found but dest exists — leaving both (no overwrite)"
  fi
}

migrate_dir() {
  local src="$1"
  local dest="$2"
  if [ -d "$src" ] && [ ! -d "$dest" ]; then
    mkdir -p "$(dirname "$dest")"
    mv "$src" "$dest"
    ok "Migrated $src → $dest"
  elif [ -d "$src" ] && [ -d "$dest" ]; then
    # Merge only if dest empty-ish of content
    if [ -z "$(ls -A "$dest" 2>/dev/null)" ]; then
      shopt -s dotglob nullglob
      mv "$src"/* "$dest"/ 2>/dev/null || true
      shopt -u dotglob nullglob
      rmdir "$src" 2>/dev/null || true
      ok "Merged empty dest from $src"
    else
      warn "Legacy $src found but $dest already has files — skipping (no overwrite)"
    fi
  fi
}

# Common legacy locations
migrate_file "$ADMIN_DIR/data/admin.db" "$DATA_DIR/database/admin.db"
migrate_file "$APP_ROOT/admin/data/admin.db" "$DATA_DIR/database/admin.db"
migrate_dir "$ADMIN_DIR/data/uploads" "$DATA_DIR/uploads"
migrate_dir "$ADMIN_DIR/data/backups" "$DATA_DIR/backups"

# ---------------------------------------------------------------------------
# 8. Optional nginx (idempotent)
# ---------------------------------------------------------------------------
if command -v apt-get >/dev/null 2>&1; then
  if ! command -v nginx >/dev/null 2>&1; then
    echo "📦 Installing nginx..."
    apt-get install -y nginx
  fi
fi

if command -v nginx >/dev/null 2>&1; then
  NGINX_SITE="/etc/nginx/sites-available/teamtracker"
  if [ ! -f "$NGINX_SITE" ]; then
    cat > "$NGINX_SITE" << NGINXEOF
server {
    listen 80;
    server_name _;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
}
NGINXEOF
    ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/teamtracker
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
    ok "Nginx configured (port 80 → ${PORT})"
  else
    ok "Nginx site already present (left unchanged)"
  fi
fi

# ---------------------------------------------------------------------------
# 9. PM2 restart with cwd=admin, env from file
# ---------------------------------------------------------------------------
cd "$ADMIN_DIR"
# Export env for PM2 process
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
pm2 start dist/server/index.js \
  --name "$PM2_NAME" \
  --cwd "$ADMIN_DIR" \
  --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
ok "PM2 process '$PM2_NAME' started (cwd=$ADMIN_DIR)"

# ---------------------------------------------------------------------------
# 10. Health checks
# ---------------------------------------------------------------------------
echo "⏳ Waiting for readiness..."
HEALTH_OK=0
READY_OK=0
for i in $(seq 1 30); do
  if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    HEALTH_OK=1
  fi
  if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/api/ready" >/dev/null 2>&1; then
    READY_OK=1
    break
  fi
  sleep 1
done

if [ "$HEALTH_OK" -ne 1 ]; then
  echo -e "${RED}✗${NC} Health check failed: GET http://127.0.0.1:${PORT}/api/health"
  pm2 logs "$PM2_NAME" --lines 40 --nostream || true
  die "Deploy aborted — process not healthy. Check: pm2 logs $PM2_NAME"
fi
ok "/api/health OK"

if [ "$READY_OK" -ne 1 ]; then
  echo -e "${RED}✗${NC} Ready check failed: GET http://127.0.0.1:${PORT}/api/ready"
  echo "    Response:"
  curl -sS --max-time 5 "http://127.0.0.1:${PORT}/api/ready" || true
  echo ""
  pm2 logs "$PM2_NAME" --lines 40 --nostream || true
  die "Deploy aborted — app not ready (DB/storage). Data dir: $DATA_DIR"
fi
ok "/api/ready OK"

# ---------------------------------------------------------------------------
# Summary + backup/restore hints
# ---------------------------------------------------------------------------
HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
PUBLIC_HINT="${PUBLIC_BASE_URL:-http://${HOSTNAME_FQDN}}"

echo ""
echo "========================================="
echo -e "  ${GREEN}TeamTracker is LIVE${NC}"
echo "========================================="
echo ""
echo "  App code:     $APP_DIR"
echo "  Persistent:   $DATA_DIR"
echo "  Env file:     $ENV_FILE"
echo "  Dashboard:    $PUBLIC_HINT"
echo "  Health:       $PUBLIC_HINT/api/health"
echo "  Ready:        $PUBLIC_HINT/api/ready"
echo ""
echo "  PM2:          pm2 status | pm2 logs $PM2_NAME"
echo "  HTTPS:        certbot --nginx -d your.domain"
echo ""
echo "  Backup / restore (brief):"
echo "    • DB backups: $DATA_DIR/backups/ (VACUUM INTO scheduler)"
echo "    • Screenshots/uploads: $DATA_DIR/uploads/"
echo "    • Manual backup:  cp $DATA_DIR/database/admin.db /safe/place/"
echo "    • Restore: stop PM2, replace admin.db (+ uploads), start PM2"
echo "    • Full guide: docs/BACKUP_RESTORE.md"
echo ""
echo "  Docs: docs/DEPLOYMENT.md"
echo "========================================="
