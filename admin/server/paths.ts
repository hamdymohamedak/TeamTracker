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

/** Package-local fallback: admin/data (works for both src and dist layouts). */
const PACKAGE_DATA_DIR = __dirname.includes(`${path.sep}dist${path.sep}`)
  ? path.join(__dirname, '../../data') // dist/server → admin/data
  : path.join(__dirname, '../data'); // server (tsx) → admin/data

const PRODUCTION_ROOT = '/var/lib/teamtracker';

/** Prefer /var/lib/teamtracker when it exists or DATA_DIR is set. */
function resolveDataRoot(): string {
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR);
  }
  if (process.env.NODE_ENV === 'production' && fs.existsSync(PRODUCTION_ROOT)) {
    return PRODUCTION_ROOT;
  }
  // Also use production root if DATABASE_PATH already points under it
  if (process.env.DATABASE_PATH) {
    const dbPath = path.resolve(process.env.DATABASE_PATH);
    if (dbPath.startsWith(PRODUCTION_ROOT)) {
      return PRODUCTION_ROOT;
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

let reconciled = false;

/** Known legacy SQLite locations from older deploy.sh layouts. */
export function listLegacyDatabaseCandidates(exclude?: string): string[] {
  const excludeResolved = exclude ? path.resolve(exclude) : '';
  const raw = [
    path.join(PACKAGE_DATA_DIR, 'admin.db'),
    // When PM2 cwd is admin/
    path.resolve(process.cwd(), 'data', 'admin.db'),
    // Durable production hosts — old git-tree layouts
    '/opt/teamtracker/admin/data/admin.db',
    '/opt/teamtracker/application/admin/data/admin.db',
    '/opt/teamtracker/teamtracker/admin/data/admin.db',
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of raw) {
    const resolved = path.resolve(p);
    if (excludeResolved && resolved === excludeResolved) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function copySqliteBundle(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o750 });
  fs.copyFileSync(src, dest);
  for (const suffix of ['-wal', '-shm'] as const) {
    const side = `${src}${suffix}`;
    if (fs.existsSync(side)) {
      fs.copyFileSync(side, `${dest}${suffix}`);
    }
  }
}

function fileNonEmpty(p: string): boolean {
  try {
    return fs.statSync(p).isFile() && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

/**
 * If the configured database path is missing/empty but a legacy DB exists,
 * copy it into place (never overwrite a non-empty destination).
 * Production only — never auto-migrate in test/dev (avoids picking up local files).
 */
export function reconcilePersistentDatabase(): string | null {
  if (reconciled) return null;
  reconciled = true;

  if (process.env.NODE_ENV !== 'production') {
    return null;
  }

  const { databasePath } = getPaths();
  if (fileNonEmpty(databasePath)) {
    return null;
  }

  for (const legacy of listLegacyDatabaseCandidates(databasePath)) {
    if (!fileNonEmpty(legacy)) continue;
    try {
      copySqliteBundle(legacy, databasePath);
      // eslint-disable-next-line no-console
      console.warn(
        `[paths] Migrated legacy SQLite ${legacy} → ${databasePath} (destination was missing/empty)`
      );
      return legacy;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[paths] Failed to migrate legacy DB from ${legacy}:`, err);
    }
  }
  return null;
}

/**
 * Replace currentPath with a specific legacy SQLite bundle.
 * Caller must close the DB connection first. Backs up the empty/new file.
 */
export function replaceDatabaseWithLegacy(currentPath: string, legacyPath: string): boolean {
  if (!fileNonEmpty(legacyPath)) return false;
  try {
    if (fs.existsSync(currentPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(currentPath, `${currentPath}.empty-bak.${stamp}`);
    }
    copySqliteBundle(legacyPath, currentPath);
    // eslint-disable-next-line no-console
    console.warn(
      `[paths] Recovered SQLite from legacy ${legacyPath} → ${currentPath}`
    );
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[paths] Legacy recovery from ${legacyPath} failed:`, err);
    return false;
  }
}

/** Test helper — reset path/reconcile caches between tests. */
export function resetPathsCacheForTests(): void {
  cached = null;
  reconciled = false;
}

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

/** Ensure all persistent directories exist; migrate legacy DB if dest empty. */
export function ensureDataDirectories(): void {
  reconcilePersistentDatabase();
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
