/**
 * SQLite backup scheduler using the Online Backup API (via sqlite3 .backup).
 * Safe against partial writes; rotates old backups by retention days.
 */

import fs from 'fs';
import path from 'path';
import { getPaths, ensureDataDirectories } from './paths.js';
import { getEnv } from './env.js';
import { logger } from './logger.js';
import { getDatabase } from './database.js';

function timestampName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `admin-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z.db`;
}

/**
 * Create a consistent SQLite backup using VACUUM INTO (SQLite 3.27+)
 * which produces a compact, consistent snapshot without locking writers long.
 * Falls back to file copy of the main DB if VACUUM INTO is unavailable.
 */
export async function createSqliteBackup(): Promise<{ path: string; bytes: number }> {
  ensureDataDirectories();
  const { databasePath, backupsDir } = getPaths();
  const dest = path.join(backupsDir, timestampName());
  const tmp = dest + '.tmp';

  const db = getDatabase();

  try {
    // Prefer VACUUM INTO for a consistent snapshot
    await db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  } catch (vacuumErr) {
    logger.warn('VACUUM INTO failed; falling back to file copy', {
      error: String(vacuumErr),
    });
    // Fallback: checkpoint WAL then copy
    try {
      await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* ignore */
    }
    fs.copyFileSync(databasePath, tmp);
  }

  // Basic verification: file exists and is non-trivial size
  const stat = fs.statSync(tmp);
  if (stat.size < 1024) {
    fs.unlinkSync(tmp);
    throw new Error('Backup verification failed: file too small');
  }

  fs.renameSync(tmp, dest);
  logger.info('SQLite backup created', { path: dest, bytes: stat.size });
  return { path: dest, bytes: stat.size };
}

export async function rotateBackups(retentionDays?: number): Promise<number> {
  const { backupsDir } = getPaths();
  const days = retentionDays ?? getEnv().backupRetentionDays;
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;

  if (!fs.existsSync(backupsDir)) return 0;

  for (const name of fs.readdirSync(backupsDir)) {
    if (!name.endsWith('.db') && !name.endsWith('.db.tmp')) continue;
    const full = path.join(backupsDir, name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs < cutoff || name.endsWith('.tmp')) {
        fs.unlinkSync(full);
        removed++;
      }
    } catch (e) {
      logger.warn('Failed to rotate backup file', { file: name, error: String(e) });
    }
  }
  return removed;
}

export function startBackupScheduler(): void {
  const env = getEnv();
  if (!env.backupEnabled) {
    logger.info('SQLite backup scheduler disabled (BACKUP_ENABLED=0)');
    return;
  }

  const intervalMs = env.backupIntervalHours * 60 * 60 * 1000;

  const tick = async () => {
    try {
      await createSqliteBackup();
      const removed = await rotateBackups();
      if (removed > 0) logger.info('Rotated old backups', { removed });
    } catch (e) {
      logger.error('Backup tick failed', { error: String(e) });
    }
  };

  // First backup shortly after boot, then on interval
  setTimeout(tick, 60_000);
  setInterval(tick, intervalMs);
  logger.info('SQLite backup scheduler started', {
    intervalHours: env.backupIntervalHours,
    retentionDays: env.backupRetentionDays,
  });
}
