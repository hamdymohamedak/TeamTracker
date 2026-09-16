# TeamTracker Production Deployment (Single VPS)

Self-host TeamTracker on one Ubuntu (or similar) VPS. **No PostgreSQL, Redis, Kubernetes, or cloud realtime service is required.** The product model is: Node.js + SQLite + nginx + PM2 + Electron desktop trackers.

## Requirements

| Item | Recommendation |
|------|----------------|
| OS | Ubuntu 20.04 / 22.04 / 24.04 (or Debian-like) |
| CPU / RAM | 1 vCPU, 1 GB RAM minimum ($6-class droplet is fine) |
| Disk | ≥10 GB; screenshots grow with retention × employees |
| Software | Node.js **18+** (20 LTS preferred), git, nginx, PM2, openssl |
| Domain (optional) | A/AAAA DNS to the VPS for HTTPS |

## Architecture (do not put data in the git tree)

```
/opt/teamtracker/application/     # git checkout — safe to replace on deploy
/var/lib/teamtracker/             # persistent — NEVER wiped by deploy
  database/admin.db
  uploads/                        # logos + screenshots
  backups/                        # VACUUM INTO snapshots
  .env                            # secrets + path config
/etc/teamtracker/                 # optional alternate for env (or keep .env under /var/lib)
```

Application code and persistent data are separated on purpose. `deploy.sh` must **never** `rm -rf /opt/teamtracker` in a way that destroys `/var/lib/teamtracker`.

## VPS preparation

```bash
# As root
apt-get update
apt-get install -y curl git nginx openssl ca-certificates
# Node 20 (example — Nodesource):
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2
```

Open firewall ports **80** and **443** (and optionally SSH only from your IP). The Node app listens on **127.0.0.1:3001** behind nginx.

## Domain + HTTPS

1. Point DNS `A`/`AAAA` for `track.yourcompany.com` at the VPS.
2. Set `PUBLIC_BASE_URL=https://track.yourcompany.com` in `/var/lib/teamtracker/.env`.
3. Install Certbot and issue a certificate:

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d track.yourcompany.com
```

Certbot will adjust the nginx site for TLS. Renewals are usually handled by a systemd timer (`certbot.timer`).

## Environment variables

Canonical list with comments: [`admin/.env.example`](../admin/.env.example).

### Required (production)

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Signs dashboard + device JWTs (≥32 chars). **Do not rotate** after enrollments. |
| `NODE_ENV` | `production` |
| `PORT` | App listen port (default `3001`) |
| `DATA_DIR` | `/var/lib/teamtracker` |
| `DATABASE_PATH` | `/var/lib/teamtracker/database/admin.db` |
| `UPLOADS_DIR` | `/var/lib/teamtracker/uploads` |
| `BACKUPS_DIR` | `/var/lib/teamtracker/backups` |

### Optional

| Variable | Purpose |
|----------|---------|
| `PUBLIC_BASE_URL` | Absolute site URL for reset/invite links |
| `CORS_ORIGIN` | Split-origin CORS allowlist |
| `SCREENSHOT_RETENTION_DAYS` | Fallback retention (org UI can override) |
| `BACKUP_ENABLED` / `BACKUP_INTERVAL_HOURS` / `BACKUP_RETENTION_DAYS` | SQLite backup scheduler |
| `RESEND_API_KEY` / `EMAIL_FROM` / `RESEND_FROM` | Email via Resend |
| `SMTP_*` | Email via SMTP |
| `DEEPSEEK_API_KEY` | Genesis AI chat |
| `SEED_DEMO_DATA` | Dev only — leave unset/`0` in production |

On the VPS, keep the real file at `/var/lib/teamtracker/.env` and symlink `admin/.env` → that file. Deploy scripts do this automatically and **only generate `JWT_SECRET` when missing**.

## First deploy

```bash
# On the VPS as root — one-shot:
curl -sSL https://raw.githubusercontent.com/hamdymohamedak/TeamTracker/main/deploy.sh | bash

# Or clone then:
git clone https://github.com/hamdymohamedak/TeamTracker.git /tmp/tt
bash /tmp/tt/deploy.sh
```

What `deploy.sh` does:

1. Preflight (root, Node, disk space)
2. Creates `/opt/teamtracker/application` and `/var/lib/teamtracker/{database,uploads,backups}`
3. Clone/pull into `APP_DIR` (default `/opt/teamtracker/application`)
4. Creates/preserves `/var/lib/teamtracker/.env`
5. `npm install` + build in `admin/`
6. Symlinks `admin/.env` → persistent env
7. One-time migrates legacy `admin/data/admin.db` if present (**never overwrites** dest)
8. Restarts PM2 with cwd=`admin`
9. Fails clearly if `/api/health` or `/api/ready` do not succeed
10. Prints short backup/restore hints

Updates:

```bash
bash /opt/teamtracker/application/deploy-enterprise.sh
# or from a checked-out copy:
bash deploy-enterprise.sh
```

Optional overrides: `APP_DIR`, `DATA_DIR`, `ENV_FILE`, `PUBLIC_BASE_URL`, `PORT`, `BRANCH`.

## PM2

```bash
pm2 status
pm2 logs teamtracker
pm2 restart teamtracker
pm2 save
```

Process: `dist/server/index.js`, **cwd** = `/opt/teamtracker/application/admin`, env loaded from `/var/lib/teamtracker/.env`.

Health endpoints (no auth):

- `GET /api/health` — process alive
- `GET /api/ready` — DB + storage usable (`503` if not)

## nginx sample

```nginx
server {
    listen 80;
    server_name track.yourcompany.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

Enable site, `nginx -t`, reload. Then run Certbot for HTTPS.

## Backups and restore

See **[BACKUP_RESTORE.md](./BACKUP_RESTORE.md)**.

Short version:

- Live DB: `/var/lib/teamtracker/database/admin.db`
- Snapshots: `/var/lib/teamtracker/backups/` (scheduler uses SQLite `VACUUM INTO`)
- Media: `/var/lib/teamtracker/uploads/`
- Secrets: `/var/lib/teamtracker/.env` (especially `JWT_SECRET`)

## Updating

```bash
# Prefer:
bash /opt/teamtracker/application/deploy-enterprise.sh

# Manual equivalent:
cd /opt/teamtracker/application
git pull --ff-only origin main
cd admin && npm install --include=dev && npm run build
pm2 restart teamtracker --update-env
curl -sf http://127.0.0.1:3001/api/health && curl -sf http://127.0.0.1:3001/api/ready
```

Persistent data under `/var/lib/teamtracker` is untouched.

## Rollback

1. `pm2 stop teamtracker`
2. In `APP_DIR`: `git log` / `git checkout <previous-good-sha>`
3. `cd admin && npm install --include=dev && npm run build`
4. If a bad migration corrupted the DB, restore the latest good file from `BACKUPS_DIR` (see BACKUP_RESTORE.md)
5. `pm2 start teamtracker` (or `restart`) and verify `/api/ready`

Do **not** restore by wiping `/var/lib/teamtracker` unless you intend to discard all customer data.

## Employee desktop install

1. Sign up / log into the dashboard.
2. **Employees → Add**, then **Setup Token**.
3. Install the tracker from [GitHub Releases](https://github.com/hamdymohamedak/TeamTracker/releases) (macOS / Windows / Linux).
4. Enroll with the setup token against your `PUBLIC_BASE_URL` (see main README).
5. Grant OS permissions (Screen Recording + Accessibility on macOS; window-title backend on Linux).

Desktop code signing / notarization for CI: **[DESKTOP_SIGNING.md](./DESKTOP_SIGNING.md)**.

Privacy / monitoring behavior: **[PRIVACY.md](./PRIVACY.md)**.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Deploy exits on health | `pm2 logs teamtracker`; ensure port free; `JWT_SECRET` ≥32 chars |
| `/api/ready` 503 | DB path exists/writable; `DATA_DIR` permissions (`chmod 750`); disk full |
| Login tokens fail after redeploy | `JWT_SECRET` was regenerated — restore previous `.env` |
| Employees offline | Desktop `serverUrl` must match public HTTPS URL; nginx WebSocket headers |
| Screenshots missing | Org setting enabled; tracker permissions; disk under `UPLOADS_DIR` |
| Email never sends | Set `RESEND_API_KEY` or `SMTP_*`; check PM2 env after edit (`pm2 restart --update-env`) |
| AI chat empty | Set `DEEPSEEK_API_KEY` |

## What you do **not** need

- PostgreSQL or any external SQL server (SQLite is the supported production DB for this product)
- Redis / Memcached
- Kubernetes, Docker Swarm, or a managed “realtime” cloud product
- A separate object store (local `uploads/` is enough; back it up with the VPS)

You *may* add those later for scale, but they are **not required** for a correct single-VPS production install.
