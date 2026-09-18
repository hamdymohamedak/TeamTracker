/**
 * Critical security & isolation tests for TeamTracker admin server.
 * Uses Node's built-in test runner + temporary SQLite DB.
 *
 * Run: cd admin && npm test
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { ensureTestEnv, cleanupTestEnv, createOrgUser as createOrgUserFixture, mockReqRes } from './helpers/index.js';

const testEnv = ensureTestEnv();

const { initDatabase, getDatabase, createEmployee, createActivity, getEmployeeById } =
  await import('../database.js');
const {
  generateDashboardToken,
  generateDeviceToken,
  requireAuth,
  requireDeviceAuth,
  verifyToken,
  hashPassword,
  issueDeviceSession,
  revokeEmployeeDeviceSessions,
  assertDeviceAccess,
} = await import('../auth.js');
const { createSqliteBackup } = await import('../backup.js');
const { getPaths, resolveScreenshotAbsolutePath, ensureDataDirectories } = await import('../paths.js');
const {
  issueRecoveryCodes,
  consumeRecoveryCode,
  countUnusedRecoveryCodes,
} = await import('../recovery-codes.js');

await initDatabase();
ensureDataDirectories();

async function createOrgUser(label: string) {
  return createOrgUserFixture(label, {
    getDatabase,
    hashPassword,
    createEmployee,
    generateDashboardToken,
    generateDeviceToken,
  });
}

describe('paths', () => {
  it('uses DATA_DIR / DATABASE_PATH', () => {
    const p = getPaths();
    assert.equal(p.databasePath, process.env.DATABASE_PATH);
    assert.ok(p.uploadsDir.includes('uploads'));
  });

  it('rejects path traversal for screenshots', () => {
    assert.equal(resolveScreenshotAbsolutePath('../../etc/passwd'), null);
    const orgId = 'org-a';
    const abs = resolveScreenshotAbsolutePath(`${orgId}/emp/2020-01-01/x.jpg`);
    assert.ok(abs);
    assert.ok(abs!.includes('screenshots'));
  });
});

describe('auth middleware types', () => {
  it('dashboard token verifies as dashboard', () => {
    const token = generateDashboardToken({ userId: 'u1', orgId: 'o1', email: 'a@b.c' });
    const payload = verifyToken(token);
    assert.equal(payload.type, 'dashboard');
  });

  it('requireAuth rejects device tokens', async () => {
    const a = await createOrgUser('auth1');
    const { req, res } = mockReqRes(`Bearer ${a.deviceToken}`);
    let nextCalled = false;
    requireAuth(req as any, res as any, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it('requireDeviceAuth rejects dashboard tokens', async () => {
    const a = await createOrgUser('auth2');
    const { req, res } = mockReqRes(`Bearer ${a.dashboardToken}`);
    let nextCalled = false;
    await requireDeviceAuth(req as any, res as any, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  it('device session stays valid until revoked', async () => {
    const a = await createOrgUser('sess1');
    const { accessToken, sessionId } = await issueDeviceSession(a.orgId, a.empId);
    const payload = verifyToken(accessToken);
    assert.equal(payload.type, 'device');
    if (payload.type === 'device') {
      assert.equal(payload.sid, sessionId);
      const ok = await assertDeviceAccess(payload);
      assert.equal(ok.ok, true);
    }

    await revokeEmployeeDeviceSessions(a.orgId, a.empId);
    if (payload.type === 'device') {
      const denied = await assertDeviceAccess(payload);
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.code, 'DEVICE_REVOKED');
    }

    const { req, res } = mockReqRes(`Bearer ${accessToken}`);
    let nextCalled = false;
    await requireDeviceAuth(req as any, res as any, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
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

describe('recovery codes', () => {
  it('issues codes and consumes one exactly once', async () => {
    const a = await createOrgUser('rec1');
    const codes = await issueRecoveryCodes(a.userId, 3);
    assert.equal(codes.length, 3);
    assert.equal(await countUnusedRecoveryCodes(a.userId), 3);

    const ok = await consumeRecoveryCode(a.userId, codes[0]);
    assert.equal(ok, true);
    assert.equal(await countUnusedRecoveryCodes(a.userId), 2);

    const again = await consumeRecoveryCode(a.userId, codes[0]);
    assert.equal(again, false);

    const ok2 = await consumeRecoveryCode(a.userId, codes[1].replace('-', '').toLowerCase());
    assert.equal(ok2, true);
  });
});

describe('migrations', () => {
  it('applies team_invites and device_sessions migrations', async () => {
    const db = getDatabase();
    const invites = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='team_invites'`);
    assert.ok(invites);
    const sessions = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='device_sessions'`);
    assert.ok(sessions);
    const recovery = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='recovery_codes'`);
    assert.ok(recovery);
    const ver = await db.get(`SELECT MAX(version) as v FROM _migrations`);
    assert.ok((ver?.v || 0) >= 8);
  });
});

after(() => {
  cleanupTestEnv(testEnv);
});
