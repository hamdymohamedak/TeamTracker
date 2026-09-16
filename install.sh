#!/bin/bash
# TeamTracker Quick Install Script
# Fresh Ubuntu VPS bootstrap. Delegates durable layout to the same conventions
# as deploy.sh: code under /opt/teamtracker/application, data under /var/lib/teamtracker.
#
# Usage: sudo bash install.sh

set -euo pipefail

echo "🏢 TeamTracker Installation"
echo "========================="
echo ""

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (use sudo)"
  exit 1
fi

APP_ROOT="${APP_ROOT:-/opt/teamtracker}"
APP_DIR="${APP_DIR:-$APP_ROOT/application}"
DATA_DIR="${DATA_DIR:-/var/lib/teamtracker}"
ENV_FILE="${ENV_FILE:-$DATA_DIR/.env}"
REPO_URL="${REPO_URL:-https://github.com/hamdymohamedak/TeamTracker.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3001}"
PM2_NAME="${PM2_NAME:-teamtracker}"

echo "📦 Updating system packages..."
apt-get update
apt-get install -y curl git nginx openssl ca-certificates

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 18 ]; then
  echo "📦 Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "📦 Installing PM2..."
npm install -g pm2

mkdir -p "$APP_DIR"
mkdir -p "$DATA_DIR"/{database,uploads,backups}
chmod 750 "$DATA_DIR" "$DATA_DIR"/database "$DATA_DIR"/uploads "$DATA_DIR"/backups

echo "📥 Downloading TeamTracker into $APP_DIR..."
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH" || true
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

ADMIN_DIR="$APP_DIR/admin"

echo "📦 Installing admin dependencies..."
cd "$ADMIN_DIR"
npm install --include=dev

echo "🔨 Building TeamTracker..."
npm run build

# Create or preserve persistent env — NEVER overwrite JWT_SECRET blindly
echo "⚙️  Configuring environment ($ENV_FILE)..."
if [ ! -f "$ENV_FILE" ]; then
  JWT_SECRET="$(openssl rand -hex 32)"
  HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
  PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://${HOSTNAME_FQDN}}"
  cat > "$ENV_FILE" << EOF
# TeamTracker production environment (persistent)
NODE_ENV=production
PORT=${PORT}

DATA_DIR=${DATA_DIR}
DATABASE_PATH=${DATA_DIR}/database/admin.db
UPLOADS_DIR=${DATA_DIR}/uploads
BACKUPS_DIR=${DATA_DIR}/backups

# IMPORTANT: Do not change after users/devices enroll.
JWT_SECRET=${JWT_SECRET}

PUBLIC_BASE_URL=${PUBLIC_BASE_URL}
EOF
  echo "✓ Created $ENV_FILE with new JWT_SECRET"
else
  echo "✓ Keeping existing $ENV_FILE (JWT_SECRET preserved)"
  # Ensure path keys exist without touching JWT_SECRET
  for kv in \
    "DATA_DIR=${DATA_DIR}" \
    "DATABASE_PATH=${DATA_DIR}/database/admin.db" \
    "UPLOADS_DIR=${DATA_DIR}/uploads" \
    "BACKUPS_DIR=${DATA_DIR}/backups" \
    "NODE_ENV=production"; do
    key="${kv%%=*}"
    val="${kv#*=}"
    if grep -qE "^${key}=" "$ENV_FILE"; then
      sed -i.bak "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
      rm -f "${ENV_FILE}.bak"
    else
      printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
    fi
  done
  # Only generate JWT_SECRET if missing
  if ! grep -qE '^JWT_SECRET=.+' "$ENV_FILE"; then
    JWT_SECRET="$(openssl rand -hex 32)"
    printf '\nJWT_SECRET=%s\n' "$JWT_SECRET" >> "$ENV_FILE"
    echo "✓ Generated missing JWT_SECRET"
  fi
fi
chmod 600 "$ENV_FILE"

# Symlink admin/.env → persistent file (do not clobber secrets into a new file)
if [ -e "$ADMIN_DIR/.env" ] && [ ! -L "$ADMIN_DIR/.env" ]; then
  # Merge: if admin/.env had a JWT and ENV_FILE is new copy path-only, prefer ENV_FILE
  cp "$ADMIN_DIR/.env" "$ADMIN_DIR/.env.install-bak.$(date +%s)" || true
  rm -f "$ADMIN_DIR/.env"
fi
ln -sfn "$ENV_FILE" "$ADMIN_DIR/.env"

# One-time legacy migrate (no overwrite)
if [ -f "$ADMIN_DIR/data/admin.db" ] && [ ! -f "$DATA_DIR/database/admin.db" ]; then
  mv "$ADMIN_DIR/data/admin.db" "$DATA_DIR/database/admin.db"
  [ -f "$ADMIN_DIR/data/admin.db-wal" ] && mv "$ADMIN_DIR/data/admin.db-wal" "$DATA_DIR/database/admin.db-wal"
  [ -f "$ADMIN_DIR/data/admin.db-shm" ] && mv "$ADMIN_DIR/data/admin.db-shm" "$DATA_DIR/database/admin.db-shm"
  echo "✓ Migrated legacy admin.db → $DATA_DIR/database/"
fi

echo "🚀 Starting TeamTracker..."
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

cd "$ADMIN_DIR"
pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
pm2 start dist/server/index.js --name "$PM2_NAME" --cwd "$ADMIN_DIR" --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "🌐 Configuring nginx..."
cat > /etc/nginx/sites-available/teamtracker << EOF
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
EOF

ln -sf /etc/nginx/sites-available/teamtracker /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
PUBLIC_HINT="${PUBLIC_BASE_URL:-http://${HOSTNAME_FQDN}}"

# Health checks
for i in $(seq 1 30); do
  if curl -sf --max-time 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null \
     && curl -sf --max-time 2 "http://127.0.0.1:${PORT}/api/ready" >/dev/null; then
    break
  fi
  sleep 1
done

echo ""
echo "✅ TeamTracker is installed and running!"
echo ""
echo "🌐 Dashboard: $PUBLIC_HINT"
echo "   Health:    $PUBLIC_HINT/api/health"
echo "   Ready:     $PUBLIC_HINT/api/ready"
echo ""
echo "Data (persistent): $DATA_DIR"
echo "Env file:          $ENV_FILE"
echo "App code:          $APP_DIR"
echo ""
echo "Next steps:"
echo "1. Open the dashboard and create your account"
echo "2. Add employees and install the desktop tracker"
echo "3. Add HTTPS: certbot --nginx -d your.domain"
echo "4. Read docs/DEPLOYMENT.md for production hardening"
echo ""
echo "pm2 status | pm2 logs $PM2_NAME | pm2 restart $PM2_NAME"
