/**
 * Central path resolution for TeamTracker persistent data.
 *
 * Production layout (recommended):
 *   /opt/teamtracker/application/     — code (safe to replace on deploy)
 *   /var/lib/teamtracker/             — persistent data (never wiped by deploy)
 *     database/admin.db
 *     uploads/  (logos, screenshots)
 *     backups/
 *
 * Development default: <admin>/data/ next to the package.
 *
 * Env overrides:
 *   DATA_DIR          — root for all persistent data
 *   DATABASE_PATH     — full path to SQLite file
 *   UPLOADS_DIR       — uploads root (logos + screenshots)
 *   BACKUPS_DIR       — backup destination
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Package-local fallback: admin/data */
const PACKAGE_DATA_DIR = path.join(__dirname, '../../data');

/** Prefer /var/lib/teamtracker when it exists or DATA_DIR is set. */
function resolveDataRoot(): string {
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR);
  }
  const productionRoot = '/var/lib/teamtracker';
  if (process.env.NODE_ENV === 'production' && fs.existsSync(productionRoot)) {
    return productionRoot;
  }
  // Also use production root if DATABASE_PATH already points under it
  if (process.env.DATABASE_PATH) {
    const dbPath = path.resolve(process.env.DATABASE_PATH);
    if (dbPath.startsWith(productionRoot)) {
      return productionRoot;
    }
  }
  return PACKAGE_DATA_DIR;
}

let cached: {
  dataRoot: string;
  databasePath: string;
  uploadsDir: string;
  screenshotsDir: string;
  backupsDir: string;
} | null = null;

export function getPaths() {
  if (cached) return cached;

  const dataRoot = resolveDataRoot();

  const databasePath = process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.join(dataRoot, 'database', 'admin.db');

  // If DATABASE_PATH is a legacy path like ./data/admin.db (file in data root),
  // keep uploads beside it for compatibility.
  const dbDir = path.dirname(databasePath);
  const legacyBesideDb = path.basename(dbDir) !== 'database';

  const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : legacyBesideDb
      ? path.join(dbDir, 'uploads')
      : path.join(dataRoot, 'uploads');

  const screenshotsDir = path.join(uploadsDir, 'screenshots');

  const backupsDir = process.env.BACKUPS_DIR
    ? path.resolve(process.env.BACKUPS_DIR)
    : legacyBesideDb
      ? path.join(dbDir, 'backups')
      : path.join(dataRoot, 'backups');

  cached = { dataRoot, databasePath, uploadsDir, screenshotsDir, backupsDir };
  return cached;
}

/** Ensure all persistent directories exist. */
export function ensureDataDirectories(): void {
  const { databasePath, uploadsDir, screenshotsDir, backupsDir } = getPaths();
  for (const dir of [path.dirname(databasePath), uploadsDir, screenshotsDir, backupsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    }
  }
}

/**
 * Resolve a stored screenshot relative URL (/uploads/screenshots/...) to an
 * absolute path, rejecting path traversal outside screenshotsDir.
 */
export function resolveScreenshotAbsolutePath(filePathOrUrl: string): string | null {
  const { screenshotsDir, uploadsDir } = getPaths();
  let relative = (filePathOrUrl || '').replace(/^\/+/, '');
  if (relative.startsWith('uploads/screenshots/')) {
    relative = relative.slice('uploads/screenshots/'.length);
  } else if (relative.startsWith('uploads/')) {
    // logo or other upload — resolve under uploadsDir
    const abs = path.resolve(uploadsDir, relative.slice('uploads/'.length));
    if (!abs.startsWith(path.resolve(uploadsDir) + path.sep) && abs !== path.resolve(uploadsDir)) {
      return null;
    }
    return abs;
  } else {
    // treat as relative to screenshots root
  }
  const abs = path.resolve(screenshotsDir, relative);
  const root = path.resolve(screenshotsDir);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    return null;
  }
  return abs;
}
