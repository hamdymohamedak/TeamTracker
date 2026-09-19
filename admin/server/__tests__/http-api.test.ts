/**
 * HTTP API integration tests against createApp().
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { ensureTestEnv, cleanupTestEnv, createOrgUser as createOrgUserFixture } from './helpers/index.js';

const testEnv = ensureTestEnv('tt-http-');

const { initDatabase, getDatabase, createEmployee } = await import('../database.js');
const {
  hashPassword,
  generateDashboardToken,
  generateDeviceToken,
} = await import('../auth.js');
const { ensureDataDirectories } = await import('../paths.js');
const { createApp, setAppReady } = await import('../app/create-app.js');

await initDatabase();
ensureDataDirectories();
setAppReady(true);

const app = createApp({ ready: true, skipStatic: true });
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function createOrgUser(label: string) {
  return createOrgUserFixture(label, {
    getDatabase,
    hashPassword,
    createEmployee,
    generateDashboardToken,
    generateDeviceToken,
  });
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<{ status: number; json: any; text: string }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  return { status: res.status, json, text };
}

describe('HTTP health', () => {
  it('GET /api/health', async () => {
    const res = await api('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'ok');
  });

  it('GET /api/lan/info is public', async () => {
    const res = await api('GET', '/api/lan/info');
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.officeName, 'string');
    assert.equal(typeof res.json.port, 'number');
    assert.equal(typeof res.json.discovery, 'boolean');
    assert.ok(Array.isArray(res.json.lanUrls));
  });
});

describe('HTTP auth', () => {
  it('login rejects bad password', async () => {
    const a = await createOrgUser('httpLogin');
    const res = await api('POST', '/api/auth/login', {
      body: { email: a.email, password: 'wrong-password' },
    });
    assert.ok(res.status === 401 || res.status === 400 || res.status === 429);
    assert.equal(res.json.success, false);
  });

  it('login succeeds with correct password', async () => {
    const a = await createOrgUser('httpLoginOk');
    const res = await api('POST', '/api/auth/login', {
      body: { email: a.email, password: 'password123' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.data?.accessToken || res.json.data?.token || res.json.accessToken);
  });

  it('me requires dashboard auth', async () => {
    const a = await createOrgUser('httpMe');
    const denied = await api('GET', '/api/auth/me');
    assert.ok(denied.status === 401 || denied.status === 403);
    const ok = await api('GET', '/api/auth/me', { token: a.dashboardToken });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.success, true);
  });

  it('device token cannot call dashboard me', async () => {
    const a = await createOrgUser('httpMeDev');
    const res = await api('GET', '/api/auth/me', { token: a.deviceToken });
    assert.ok(res.status === 401 || res.status === 403);
  });
});

describe('HTTP employees org isolation', () => {
  it('lists only own org employees', async () => {
    const a = await createOrgUser('httpEmpA');
    const b = await createOrgUser('httpEmpB');
    const resA = await api('GET', '/api/employees', { token: a.dashboardToken });
    assert.equal(resA.status, 200);
    const idsA = (resA.json.data as any[]).map((e) => e.id);
    assert.ok(idsA.includes(a.empId));
    assert.ok(!idsA.includes(b.empId));

    const cross = await api('GET', `/api/employees/${b.empId}`, { token: a.dashboardToken });
    assert.equal(cross.status, 404);
  });

  it('creates employee in caller org', async () => {
    const a = await createOrgUser('httpEmpCreate');
    const res = await api('POST', '/api/employees', {
      token: a.dashboardToken,
      body: { name: 'New Hire', email: 'newhire@test.com', role: 'employee' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.orgId, a.orgId);
  });
});

describe('HTTP activity ingest', () => {
  it('device can post own activities', async () => {
    const a = await createOrgUser('httpAct');
    const res = await api('POST', '/api/activity', {
      token: a.deviceToken,
      body: {
        activities: [
          {
            timestamp: new Date().toISOString(),
            appName: 'Code',
            windowTitle: 'file.ts',
            category: 'development',
            categoryName: 'Development',
            productivityScore: 90,
            productivityLevel: 'productive',
            durationSeconds: 60,
          },
        ],
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.data.syncedCount >= 1);
  });

  it('dashboard cannot ingest for other-org employee', async () => {
    const a = await createOrgUser('httpActA');
    const b = await createOrgUser('httpActB');
    const res = await api('POST', '/api/activity', {
      token: a.dashboardToken,
      body: {
        employeeId: b.empId,
        activities: [
          {
            timestamp: new Date().toISOString(),
            appName: 'Code',
            windowTitle: 'x',
            category: 'development',
            categoryName: 'Development',
            productivityScore: 50,
            productivityLevel: 'neutral',
            durationSeconds: 10,
          },
        ],
      },
    });
    assert.equal(res.status, 404);
  });
});

describe('HTTP privacy blocks isolation', () => {
  it('blocks are org-scoped', async () => {
    const a = await createOrgUser('httpPrivA');
    const b = await createOrgUser('httpPrivB');
    const created = await api('POST', '/api/privacy-blocks', {
      token: a.dashboardToken,
      body: {
        appPattern: 'whatsapp.com',
        blockScreenshots: true,
        blockLiveView: true,
      },
    });
    assert.equal(created.status, 200);
    assert.equal(created.json.success, true);

    const listB = await api('GET', '/api/privacy-blocks', { token: b.dashboardToken });
    assert.equal(listB.status, 200);
    const patterns = (listB.json.data as any[]).map((p) => p.appPattern || p.app_pattern);
    assert.ok(!patterns.includes('whatsapp.com') && !patterns.some((p) => String(p).includes('whatsapp')));
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  cleanupTestEnv(testEnv);
});
