/**
 * Critical security & isolation tests for TeamTracker admin server.
 * Uses Node's built-in test runner + temporary SQLite DB.
 *
 * Run: cd admin && npm test
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Isolate test DB before importing server modules
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-test-'));
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long!!';
process.env.DATA_DIR = testRoot;
process.env.DATABASE_PATH = path.join(testRoot, 'database', 'admin.db');
process.env.UPLOADS_DIR = path.join(testRoot, 'uploads');
process.env.BACKUPS_DIR = path.join(testRoot, 'backups');
process.env.BACKUP_ENABLED = '0';
process.env.SEED_DEMO_DATA = '0';

const { initDatabase, getDatabase, createEmployee, createActivity, getEmployeeById } =
  await import('../database.js');
const {
  generateDashboardToken,
  generateDeviceToken,
  requireAuth,
  requireDeviceAuth,
  verifyToken,
  hashPassword,
} = await import('../auth.js');
const { createSqliteBackup } = await import('../backup.js');
const { getPaths, resolveScreenshotAbsolutePath, ensureDataDirectories } = await import('../paths.js');

await initDatabase();
ensureDataDirectories();

async function createOrgUser(label: string) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const orgId = `org-${label}`;
  const userId = `user-${label}`;
  const empId = `emp-${label}`;
  await db.run(
    `INSERT INTO organizations (id, name, slug, owner_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [orgId, `Org ${label}`, `org-${label}`, `${label}@test.com`, now, now]
  );
  const passwordHash = await hashPassword('password123');
  await db.run(
    `INSERT INTO users (id, org_id, email, password_hash, name, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'owner', ?, ?)`,
    [userId, orgId, `${label}@test.com`, passwordHash, `Owner ${label}`, now, now]
  );
  await createEmployee({
    id: empId,
    orgId,
    name: `Employee ${label}`,
    email: `emp-${label}@test.com`,
    role: 'employee',
    createdAt: now,
    updatedAt: now,
  });
  const dashboardToken = generateDashboardToken({ userId, orgId, email: `${label}@test.com` });
  const deviceToken = generateDeviceToken({ employeeId: empId, orgId });
  return { orgId, userId, empId, dashboardToken, deviceToken };
}

describe('paths', () => {
  it('uses DATA_DIR / DATABASE_PATH', () => {
    const p = getPaths();
    assert.equal(p.databasePath, process.env.DATABASE_PATH);
    assert.ok(p.uploadsDir.includes('uploads'));
  });

  it('rejects path traversal for screenshots', () => {
    assert.equal(resolveScreenshotAbsolutePath('../../etc/passwd'), null);
    const { orgId } = { orgId: 'org-a' };
    // relative under screenshots is ok structurally
    const abs = resolveScreenshotAbsolutePath(`${orgId}/emp/2020-01-01/x.jpg`);
    assert.ok(abs);
    assert.ok(abs!.includes('screenshots'));
  });
});

describe('auth middleware types', () => {
  it('dashboard token verifies as dashboard', () => {
    const { orgId, userId } = { orgId: 'o1', userId: 'u1' };
    const token = generateDashboardToken({ userId, orgId, email: 'a@b.c' });
    const payload = verifyToken(token);
    assert.equal(payload.type, 'dashboard');
  });

  it('requireAuth rejects device tokens', async () => {
    const a = await createOrgUser('auth1');
    const req: any = { headers: { authorization: `Bearer ${a.deviceToken}` } };
    const res: any = {
      statusCode: 200,
      body: null,
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      json(b: unknown) {
        this.body = b;
        return this;
      },
    };
    let nextCalled = false;
    requireAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it('requireDeviceAuth rejects dashboard tokens', async () => {
    const a = await createOrgUser('auth2');
    const req: any = { headers: { authorization: `Bearer ${a.dashboardToken}` } };
    const res: any = {
      statusCode: 200,
      body: null,
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      json(b: unknown) {
        this.body = b;
        return this;
      },
    };
    let nextCalled = false;
    requireDeviceAuth(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });
});

describe('multi-tenant isolation', () => {
  it('org A cannot read org B employee', async () => {
    const a = await createOrgUser('isoA');
    const b = await createOrgUser('isoB');
    const cross = await getEmployeeById(a.orgId, b.empId);
    assert.equal(cross, null);
    const own = await getEmployeeById(b.orgId, b.empId);
    assert.ok(own);
    assert.equal(own!.id, b.empId);
  });

  it('activities are org-scoped on create+read', async () => {
    const a = await createOrgUser('actA');
    const b = await createOrgUser('actB');
    const now = new Date().toISOString();
    await createActivity(a.orgId, {
      id: 'act-1',
      employeeId: a.empId,
      timestamp: now,
      appName: 'Code',
      windowTitle: 'app',
      category: 'development',
      categoryName: 'Development',
      productivityScore: 90,
      productivityLevel: 'productive',
      isSuspicious: false,
      isIdle: false,
      idleTimeSeconds: 0,
      durationSeconds: 60,
      createdAt: now,
    });
    const db = getDatabase();
    const leaked = await db.get(
      `SELECT * FROM activities WHERE id = ? AND org_id = ?`,
      ['act-1', b.orgId]
    );
    assert.equal(leaked, undefined);
    const owned = await db.get(
      `SELECT * FROM activities WHERE id = ? AND org_id = ?`,
      ['act-1', a.orgId]
    );
    assert.ok(owned);
  });
});

describe('backup', () => {
  it('creates a non-empty backup file', async () => {
    const result = await createSqliteBackup();
    assert.ok(fs.existsSync(result.path));
    assert.ok(result.bytes > 1024);
  });
});

describe('migrations', () => {
  it('applies team_invites migration', async () => {
    const db = getDatabase();
    const row = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='team_invites'`);
    assert.ok(row);
    const ver = await db.get(`SELECT MAX(version) as v FROM _migrations`);
    assert.ok((ver?.v || 0) >= 6);
  });
});

after(() => {
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
