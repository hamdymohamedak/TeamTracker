// Screenshot retention cleanup — per-organization retention when available.
//
// Prunes screenshots (files + DB rows) older than each org's
// screenshot_retention_days (fallback: SCREENSHOT_RETENTION_DAYS env / 30).
// Runs once on boot and then hourly.

import fs from 'fs/promises';
import path from 'path';
import { getDatabase } from './database.js';
import { getPaths, ensureDataDirectories, resolveScreenshotAbsolutePath } from './paths.js';
import { getEnv } from './env.js';
import { logger } from './logger.js';

async function pruneOnce(): Promise<void> {
  ensureDataDirectories();
  const { screenshotsDir } = getPaths();
  const db = getDatabase();
  const globalDefault = getEnv().screenshotRetentionDays;

  const orgs = await db.all(
    `SELECT id, screenshot_retention_days FROM organizations`
  );

  let totalDeleted = 0;

  // Also handle orphaned screenshots with no matching org (legacy)
  const orgIds = new Set((orgs || []).map((o: any) => o.id));

  for (const org of orgs || []) {
    const days =
      typeof org.screenshot_retention_days === 'number' && org.screenshot_retention_days > 0
        ? org.screenshot_retention_days
        : globalDefault;
    const cutoffIso = new Date(Date.now() - days * 86400000).toISOString();

    const stale = await db.all(
      `SELECT id, file_path FROM screenshots WHERE org_id = ? AND timestamp < ?`,
      [org.id, cutoffIso]
    );

    for (const row of stale) {
      const abs = resolveScreenshotAbsolutePath(row.file_path);
      if (abs) {
        try {
          await fs.unlink(abs);
        } catch (e: any) {
          if (e?.code !== 'ENOENT') {
            logger.warn('retention delete failed', { path: abs, error: String(e) });
          }
        }
      }
    }

    if (stale.length > 0) {
      await db.run(
        `DELETE FROM screenshots WHERE org_id = ? AND timestamp < ?`,
        [org.id, cutoffIso]
      );
      totalDeleted += stale.length;
    }
  }

  // Sweep empty date folders
  try {
    const orgDirs = await fs.readdir(screenshotsDir).catch(() => []);
    for (const org of orgDirs) {
      const orgDir = path.join(screenshotsDir, org);
      const emps = await fs.readdir(orgDir).catch(() => []);
      for (const emp of emps) {
        const empDir = path.join(orgDir, emp);
        const days = await fs.readdir(empDir).catch(() => []);
        for (const day of days) {
          const dayDir = path.join(empDir, day);
          try {
            const contents = await fs.readdir(dayDir);
            if (contents.length === 0) await fs.rmdir(dayDir);
          } catch { /* ignore */ }
        }
      }
    }
  } catch (e) {
    logger.warn('retention empty-folder sweep failed', { error: String(e) });
  }

  if (totalDeleted > 0) {
    logger.info('Screenshot retention prune complete', { deleted: totalDeleted });
  }
}

export function startScreenshotRetentionScheduler(): void {
  const tick = async () => {
    try {
      await pruneOnce();
    } catch (e) {
      logger.error('Screenshot retention tick failed', { error: String(e) });
    }
  };

  setTimeout(tick, 30_000);
  setInterval(tick, 60 * 60 * 1000);
  logger.info('Screenshot retention scheduler started', {
    defaultDays: getEnv().screenshotRetentionDays,
  });
}
