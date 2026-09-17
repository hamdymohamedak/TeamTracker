/**
 * Persistent path / legacy DB migrate tests.
 */
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-paths-'));
const legacyDir = path.join(testRoot, 'legacy');
const durableDir = path.join(testRoot, 'durable');

fs.mkdirSync(path.join(legacyDir), { recursive: true });
fs.mkdirSync(path.join(durableDir, 'database'), { recursive: true });
fs.writeFileSync(path.join(legacyDir, 'admin.db'), 'LEGACY-SQLITE-BYTES');

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = durableDir;
process.env.DATABASE_PATH = path.join(durableDir, 'database', 'admin.db');
process.env.UPLOADS_DIR = path.join(durableDir, 'uploads');
process.env.BACKUPS_DIR = path.join(durableDir, 'backups');

const {
  getPaths,
  ensureDataDirectories,
  reconcilePersistentDatabase,
  replaceDatabaseWithLegacy,
  listLegacyDatabaseCandidates,
  resetPathsCacheForTests,
} = await import('../paths.js');

describe('legacy database reconcile', () => {
  beforeEach(() => {
    resetPathsCacheForTests();
    // Reset dest each test
    const dest = process.env.DATABASE_PATH!;
    for (const f of [dest, `${dest}-wal`, `${dest}-shm`]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* missing */
      }
    }
  });

  after(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('lists candidates and excludes current path', () => {
    const dest = process.env.DATABASE_PATH!;
    const list = listLegacyDatabaseCandidates(dest);
    assert.ok(!list.includes(path.resolve(dest)));
    assert.ok(list.length >= 1);
  });

  it('copies legacy DB when destination is missing', () => {
    const dest = process.env.DATABASE_PATH!;
    // Point a candidate via cwd-relative path used by listLegacyDatabaseCandidates:
    // process.cwd()/data/admin.db — create it under a temp cwd is hard; use replace API instead.
    const legacy = path.join(legacyDir, 'admin.db');
    assert.equal(replaceDatabaseWithLegacy(dest, legacy), true);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'LEGACY-SQLITE-BYTES');
  });

  it('ensureDataDirectories creates dirs without throwing', () => {
    ensureDataDirectories();
    const p = getPaths();
    assert.ok(fs.existsSync(path.dirname(p.databasePath)));
    assert.ok(fs.existsSync(p.uploadsDir));
  });

  it('reconcile is a no-op outside production', () => {
    const dest = process.env.DATABASE_PATH!;
    assert.equal(process.env.NODE_ENV, 'test');
    const migrated = reconcilePersistentDatabase();
    assert.equal(migrated, null);
    assert.equal(fs.existsSync(dest), false);
  });

  it('reconcile is idempotent when dest already populated', () => {
    const dest = process.env.DATABASE_PATH!;
    fs.writeFileSync(dest, 'ALREADY-THERE');
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    resetPathsCacheForTests();
    const migrated = reconcilePersistentDatabase();
    process.env.NODE_ENV = prev;
    assert.equal(migrated, null);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'ALREADY-THERE');
  });
});
