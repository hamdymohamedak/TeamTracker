# TeamTracker Backup & Restore

Single-VPS layout. Persistent data is **outside** the git checkout so deploys cannot wipe it.

## Where things live

| Asset | Default path |
|-------|----------------|
| Application code | `/opt/teamtracker/application` |
| Env / secrets | `/var/lib/teamtracker/.env` |
| SQLite DB | `/var/lib/teamtracker/database/admin.db` |
| WAL/SHM (if present) | `admin.db-wal`, `admin.db-shm` beside the DB |
| Logos + screenshots | `/var/lib/teamtracker/uploads/` |
| Automated DB backups | `/var/lib/teamtracker/backups/` |

Override with `DATA_DIR`, `DATABASE_PATH`, `UPLOADS_DIR`, `BACKUPS_DIR` in `.env`.

## How automated backups work

The admin server starts a backup scheduler (unless `BACKUP_ENABLED=0`):

1. Shortly after boot, then every `BACKUP_INTERVAL_HOURS` (default **24**).
2. Creates a consistent snapshot with SQLite **`VACUUM INTO`** into `BACKUPS_DIR` (timestamped `admin-YYYYMMDD-HHMMSSZ.db`).
3. If `VACUUM INTO` fails, falls back to WAL checkpoint + file copy.
4. Deletes backups older than `BACKUP_RETENTION_DAYS` (default **14**).

Implementation: `admin/server/backup.ts`.

**Important:** automated backups cover the **database**. They do **not** by themselves archive the entire `uploads/` tree. Back up screenshots/logos separately (rsync, snapshots, or tarball).

### Recommended off-box copy

```bash
# Example nightly (cron as root) — adjust destinations
rsync -a /var/lib/teamtracker/database/ /backup/teamtracker/database/
rsync -a /var/lib/teamtracker/uploads/   /backup/teamtracker/uploads/
rsync -a /var/lib/teamtracker/backups/   /backup/teamtracker/backups/
install -m 600 /var/lib/teamtracker/.env /backup/teamtracker/env.gpg.plain.protect-me
```

Encrypt off-site copies. Always include `.env` (`JWT_SECRET`) or restored tokens will not validate.

## Manual DB snapshot

With the app running (prefer the in-app API path) or offline:

```bash
# Online-ish: copy latest VACUUM backup
ls -lt /var/lib/teamtracker/backups/*.db | head

# Offline cold copy
pm2 stop teamtracker
cp -a /var/lib/teamtracker/database/admin.db /safe/place/admin-$(date -u +%Y%m%d).db
# If using WAL mode and you stopped cleanly, also copy -wal/-shm if present
pm2 start teamtracker
```

## Restore database on the same VPS

1. Pick a good backup file from `/var/lib/teamtracker/backups/` (or off-box copy).
2. Stop the app: `pm2 stop teamtracker`
3. Replace the live DB (**this overwrites current data**):

```bash
cp -a /var/lib/teamtracker/database/admin.db \
      /var/lib/teamtracker/database/admin.db.pre-restore.$(date +%s)
cp -a /path/to/good-backup.db /var/lib/teamtracker/database/admin.db
# Remove stale WAL/SHM so SQLite opens the restored file cleanly
rm -f /var/lib/teamtracker/database/admin.db-wal \
      /var/lib/teamtracker/database/admin.db-shm
```

4. Start: `pm2 start teamtracker`
5. Verify: `curl -sf http://127.0.0.1:3001/api/ready`

Restore matching `uploads/` from the same point in time if screenshot paths in the DB must resolve.

## Restore uploads only

```bash
pm2 stop teamtracker   # optional but safer for consistency
rsync -a /backup/teamtracker/uploads/ /var/lib/teamtracker/uploads/
pm2 start teamtracker
```

## Migrate to a new VPS

On the **old** server:

```bash
pm2 stop teamtracker
tar -C /var/lib -czf /root/teamtracker-data.tgz teamtracker
# Securely copy teamtracker-data.tgz and note APP git revision
```

On the **new** server:

1. Run `deploy.sh` (or `install.sh`) so directories, nginx, and PM2 exist.
2. `pm2 stop teamtracker`
3. Extract data:

```bash
tar -C /var/lib -xzf teamtracker-data.tgz
chmod 750 /var/lib/teamtracker
chmod 600 /var/lib/teamtracker/.env
```

4. Set `PUBLIC_BASE_URL` to the new hostname/HTTPS URL; update DNS.
5. Ensure `admin/.env` symlinks to `/var/lib/teamtracker/.env`.
6. Checkout the **same or compatible** app version under `/opt/teamtracker/application`, build, `pm2 restart teamtracker --update-env`.
7. Confirm `/api/health` and `/api/ready`; re-issue Certbot certs for the new host.

Desktop trackers use `serverUrl` / enroll URL — point them at the new public URL (re-enroll if needed).

## What deploy scripts will not do

- They will **not** `rm -rf` `/var/lib/teamtracker`.
- Legacy `admin/data/admin.db` is moved into `/var/lib/teamtracker/database/` **only if the destination file does not already exist**.

See also [DEPLOYMENT.md](./DEPLOYMENT.md).
