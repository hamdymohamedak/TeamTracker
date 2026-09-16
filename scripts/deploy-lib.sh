#!/bin/bash
# Shared helpers for TeamTracker deploy/install scripts.
# Source after APP_DIR / DATA_DIR / ADMIN_DIR / ENV_FILE are set.
#
# Guarantees:
#   - Never rotate JWT_SECRET when already present
#   - Never overwrite an existing database with a legacy copy
#   - Persistent data lives under DATA_DIR (default /var/lib/teamtracker)

# shellcheck shell=bash

tt_die() { echo "ERROR: $*" >&2; exit 1; }
tt_ok() { echo "✓ $*"; }
tt_warn() { echo "! $*"; }

tt_upsert_env() {
  local file="$1" key="$2" value="$3"
  [ -n "$file" ] && [ -n "$key" ] || return 1
  if [ -f "$file" ] && grep -qE "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
    rm -f "${file}.bak"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

tt_env_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 0
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true
}

tt_ensure_data_dirs() {
  local root="${1:-$DATA_DIR}"
  mkdir -p "$root"/{database,uploads/screenshots,backups}
  chmod 750 "$root" "$root"/database "$root"/uploads "$root"/backups 2>/dev/null || true
}

# Copy SQLite main + WAL/SHM if present. Never overwrite an existing non-empty dest.
tt_copy_sqlite() {
  local src="$1" dest="$2"
  [ -f "$src" ] || return 1
  if [ -f "$dest" ] && [ -s "$dest" ]; then
    return 2
  fi
  mkdir -p "$(dirname "$dest")"
  cp -a "$src" "$dest"
  [ -f "${src}-wal" ] && cp -a "${src}-wal" "${dest}-wal"
  [ -f "${src}-shm" ] && cp -a "${src}-shm" "${dest}-shm"
  return 0
}

# One-time migrate from common legacy locations → $DATA_DIR/database/admin.db
tt_migrate_legacy_database() {
  local dest="${DATA_DIR}/database/admin.db"
  local admin="${ADMIN_DIR:-}"
  local candidates=()

  if [ -n "$admin" ]; then
    candidates+=(
      "$admin/data/admin.db"
      "$admin/../data/admin.db"
    )
  fi
  candidates+=(
    /opt/teamtracker/admin/data/admin.db
    /opt/teamtracker/application/admin/data/admin.db
    /opt/teamtracker/teamtracker/admin/data/admin.db
  )

  if [ -f "$dest" ] && [ -s "$dest" ]; then
    return 0
  fi

  local src
  for src in "${candidates[@]}"; do
    # Skip if same path as dest
    if [ -f "$src" ] && [ "$(readlink -f "$src" 2>/dev/null || echo "$src")" = "$(readlink -f "$dest" 2>/dev/null || echo "$dest")" ]; then
      continue
    fi
    if [ -f "$src" ] && [ -s "$src" ]; then
      if tt_copy_sqlite "$src" "$dest"; then
        tt_ok "Migrated legacy database → $dest (from $src)"
        return 0
      fi
    fi
  done
  return 0
}

# Prefer JWT from durable ENV_FILE; if missing, harvest from admin/.env (non-symlink)
tt_preserve_jwt_from_admin_env() {
  local durable="${1:-$ENV_FILE}"
  local admin_env="${ADMIN_DIR}/.env"
  local existing
  existing="$(tt_env_get "$durable" JWT_SECRET)"
  if [ -n "$existing" ]; then
    return 0
  fi
  if [ -f "$admin_env" ] && [ ! -L "$admin_env" ]; then
    local from_admin
    from_admin="$(tt_env_get "$admin_env" JWT_SECRET)"
    if [ -n "$from_admin" ]; then
      tt_upsert_env "$durable" "JWT_SECRET" "$from_admin"
      tt_ok "Preserved JWT_SECRET from admin/.env → $durable"
    fi
  fi
}

tt_ensure_production_env() {
  local durable="${1:-$ENV_FILE}"
  local port="${PORT:-3001}"
  local data="${DATA_DIR}"
  local public_url="${PUBLIC_BASE_URL:-}"

  tt_ensure_data_dirs "$data"

  if [ ! -f "$durable" ]; then
    # Prefer copying real admin/.env (keeps JWT) over inventing a new secret
    if [ -f "${ADMIN_DIR}/.env" ] && [ ! -L "${ADMIN_DIR}/.env" ]; then
      cp "${ADMIN_DIR}/.env" "$durable"
      tt_ok "Copied admin/.env → $durable"
    else
      local jwt
      jwt="$(openssl rand -hex 32)"
      local host
      host="$(hostname -f 2>/dev/null || hostname)"
      cat > "$durable" << EOF
# TeamTracker production environment (persistent — do not store under git tree)
NODE_ENV=production
PORT=${port}

DATA_DIR=${data}
DATABASE_PATH=${data}/database/admin.db
UPLOADS_DIR=${data}/uploads
BACKUPS_DIR=${data}/backups

# IMPORTANT: Do not change after users/devices enroll.
JWT_SECRET=${jwt}

PUBLIC_BASE_URL=${public_url:-http://${host}}
EOF
      tt_ok "Created $durable with new JWT_SECRET"
    fi
  fi

  chmod 600 "$durable"
  tt_preserve_jwt_from_admin_env "$durable"

  # Path keys always point at durable data; never touch JWT_SECRET here
  tt_upsert_env "$durable" "DATA_DIR" "$data"
  tt_upsert_env "$durable" "DATABASE_PATH" "${data}/database/admin.db"
  tt_upsert_env "$durable" "UPLOADS_DIR" "${data}/uploads"
  tt_upsert_env "$durable" "BACKUPS_DIR" "${data}/backups"
  tt_upsert_env "$durable" "NODE_ENV" "production"

  if [ -z "$(tt_env_get "$durable" JWT_SECRET)" ]; then
    tt_upsert_env "$durable" "JWT_SECRET" "$(openssl rand -hex 32)"
    tt_warn "JWT_SECRET was missing — generated once. Existing sessions/devices must re-auth."
  fi

  if [ -n "$public_url" ]; then
    tt_upsert_env "$durable" "PUBLIC_BASE_URL" "$public_url"
  fi

  # Symlink admin/.env → durable file (backup real file first)
  if [ -e "${ADMIN_DIR}/.env" ] && [ ! -L "${ADMIN_DIR}/.env" ]; then
    cp "${ADMIN_DIR}/.env" "${ADMIN_DIR}/.env.deploy-bak.$(date +%s)" 2>/dev/null || true
    rm -f "${ADMIN_DIR}/.env"
  fi
  ln -sfn "$durable" "${ADMIN_DIR}/.env"
  tt_ok "admin/.env → $durable"
}

tt_migrate_legacy_uploads() {
  local dest="${DATA_DIR}/uploads"
  local admin="${ADMIN_DIR:-}"
  local src=""
  if [ -n "$admin" ] && [ -d "$admin/data/uploads" ]; then
    src="$admin/data/uploads"
  elif [ -d /opt/teamtracker/admin/data/uploads ]; then
    src="/opt/teamtracker/admin/data/uploads"
  fi
  [ -n "$src" ] || return 0
  # Only seed if dest has no screenshots/logos yet
  if [ -d "$dest" ] && [ -n "$(find "$dest" -type f 2>/dev/null | head -1)" ]; then
    return 0
  fi
  if [ -d "$src" ] && [ -n "$(find "$src" -type f 2>/dev/null | head -1)" ]; then
    mkdir -p "$dest"
    cp -a "$src"/. "$dest"/
    tt_ok "Migrated legacy uploads → $dest"
  fi
}
