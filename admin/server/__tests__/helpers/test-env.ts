/**
 * Shared test environment bootstrap for admin server tests.
 * Call ensureTestEnv() before importing server modules that read env/paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type TestEnv = {
  testRoot: string;
  databasePath: string;
  uploadsDir: string;
  backupsDir: string;
};

let cached: TestEnv | null = null;

/** Create an isolated DATA_DIR and set process.env before server imports. */
export function ensureTestEnv(prefix = 'tt-test-'): TestEnv {
  if (cached) return cached;

  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const databasePath = path.join(testRoot, 'database', 'admin.db');
  const uploadsDir = path.join(testRoot, 'uploads');
  const backupsDir = path.join(testRoot, 'backups');

  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters-long!!';
  process.env.DATA_DIR = testRoot;
  process.env.DATABASE_PATH = databasePath;
  process.env.UPLOADS_DIR = uploadsDir;
  process.env.BACKUPS_DIR = backupsDir;
  process.env.BACKUP_ENABLED = '0';
  process.env.SEED_DEMO_DATA = '0';

  // Extra guard if a file forgot --import silence-stdout (IPC-safe tests).
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};

  cached = { testRoot, databasePath, uploadsDir, backupsDir };
  return cached;
}

export function cleanupTestEnv(env: TestEnv = cached!): void {
  if (!env) return;
  try {
    fs.rmSync(env.testRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  if (cached === env) cached = null;
}
