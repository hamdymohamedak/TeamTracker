/**
 * WebSocket integration tests for the refactored websocket/ module.
 *
 * Two levels:
 *  1. Pure unit tests on exported helpers (clients map, getConnectedEmployees, isEmployeeOnline).
 *  2. A short-lived WebSocketServer round-trip: device token connects → sends
 *     "register" → admin sees "employee:online" + presence snapshot.
 *
 * Run: cd admin && npm test
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

import { ensureTestEnv, cleanupTestEnv } from './helpers/index.js';

const testEnv = ensureTestEnv('tt-ws-test-');

// ── lazy-import server modules after env is set ───────────────────────────────
const { initDatabase, createEmployee, getDatabase } = await import('../database.js');
const { generateDashboardToken, issueDeviceSession } = await import('../auth.js');
const { setupWebSocket } = await import('../websocket.js');
const {
  clients,
  getConnectedEmployees,
  isEmployeeOnline,
} = await import('../websocket/clients.js');

await initDatabase();

// ── helpers ───────────────────────────────────────────────────────────────────

const ORG_ID = 'org-ws-test';
const EMP_ID  = 'emp-ws-test';

async function seedOrg() {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.run(
    `INSERT OR IGNORE INTO organizations (id, name, slug, owner_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [ORG_ID, 'WS Test Org', 'ws-test-org', 'ws@test.com', now, now]
  );
  await createEmployee({
    id: EMP_ID,
    orgId: ORG_ID,
    name: 'WS Employee',
    email: 'emp@ws-test.com',
    role: 'employee',
    createdAt: now,
    updatedAt: now,
  });
}

function makeDeviceToken(): Promise<string> {
  return issueDeviceSession(ORG_ID, EMP_ID).then(({ accessToken }) => accessToken);
}

function makeDashboardToken(): string {
  return generateDashboardToken({ userId: 'admin-ws-test', orgId: ORG_ID, email: 'admin@ws.com' });
}

// ── WsClient wrapper — buffers messages arriving before listeners are ready ───
// This prevents the race between the server firing `connection` (before client
// fires `open`) and our test calling waitForMessage.

interface WsClient {
  ws: WebSocket;
  /** Resolves with the next message (buffered if it arrived early). */
  nextMessage(timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

function connectWsClient(port: number, token: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`
    );

    const buffered: unknown[] = [];
    const waiters: Array<(msg: unknown) => void> = [];

    // Register the message handler BEFORE `open` fires so that messages
    // arriving in the same I/O tick as `open` are never missed.
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as unknown;
      if (waiters.length > 0) {
        waiters.shift()!(msg);
      } else {
        buffered.push(msg);
      }
    });

    const client: WsClient = {
      ws,
      nextMessage(timeoutMs = 5000): Promise<unknown> {
        if (buffered.length > 0) return Promise.resolve(buffered.shift());
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            const idx = waiters.indexOf(waiterFn);
            if (idx >= 0) waiters.splice(idx, 1);
            rej(new Error('Timed out waiting for WebSocket message'));
          }, timeoutMs);
          function waiterFn(msg: unknown) { clearTimeout(timer); res(msg); }
          waiters.push(waiterFn);
          ws.once('error', (err) => { clearTimeout(timer); rej(err); });
          ws.once('close', (code) => {
            clearTimeout(timer);
            rej(new Error(`WebSocket closed unexpectedly (code ${code})`));
          });
        });
      },
      close(): Promise<void> {
        return new Promise((res) => {
          if (ws.readyState === WebSocket.CLOSED) { res(); return; }
          ws.once('close', res);
          ws.close();
        });
      },
    };

    ws.once('open', () => resolve(client));
    ws.once('error', reject);
  });
}

/**
 * Poll until the employee appears in the shared clients map (i.e. auth has
 * completed and the message handler has been registered on the server).
 * This avoids the race where a device sends a message before the server has
 * finished async auth and registered its `ws.on('message', ...)` handler.
 */
async function waitForEmployeeReady(
  orgId: string,
  empId: string,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!isEmployeeOnline(orgId, empId)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for employee ${empId} to be ready on server`);
    }
    await new Promise<void>((r) => setTimeout(r, 10));
  }
}

/** Wait for a raw WS to close with a specific close code (for rejection tests). */
function waitForClose(port: number, token?: string): Promise<number> {
  return new Promise((resolve) => {
    const url = token
      ? `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`
      : `ws://127.0.0.1:${port}/`;
    const ws = new WebSocket(url);
    ws.once('close', (code) => resolve(code));
    ws.once('error', () => resolve(-1));
  });
}

// ── Unit tests (no server needed) ─────────────────────────────────────────────

describe('websocket clients helpers (unit)', () => {
  it('getConnectedEmployees returns empty list when no clients match', () => {
    const result = getConnectedEmployees('unit-test-org-never-exists');
    assert.deepEqual(result, []);
  });

  it('isEmployeeOnline returns false for unknown employee', () => {
    assert.equal(isEmployeeOnline('no-org', 'no-emp'), false);
  });

  it('getConnectedEmployees respects orgId filter', () => {
    const fakeWs = { readyState: WebSocket.OPEN } as WebSocket;
    clients.set(fakeWs, {
      ws: fakeWs,
      orgId: 'org-fake-unit',
      employeeId: 'emp-fake-unit',
      employeeName: 'Fake Employee',
      isAdmin: false,
      tokenType: 'device',
    });

    const inOrg = getConnectedEmployees('org-fake-unit');
    assert.equal(inOrg.length, 1);
    assert.equal(inOrg[0].employeeId, 'emp-fake-unit');

    const otherOrg = getConnectedEmployees('org-other');
    assert.equal(otherOrg.length, 0);

    clients.delete(fakeWs);
  });

  it('isEmployeeOnline returns true for injected client, false for other', () => {
    const fakeWs = { readyState: WebSocket.OPEN } as WebSocket;
    clients.set(fakeWs, {
      ws: fakeWs,
      orgId: 'org-online-unit',
      employeeId: 'emp-online-unit',
      isAdmin: false,
      tokenType: 'device',
    });

    assert.equal(isEmployeeOnline('org-online-unit', 'emp-online-unit'), true);
    assert.equal(isEmployeeOnline('org-online-unit', 'emp-other'), false);

    clients.delete(fakeWs);
  });
});

// ── Integration tests (live WebSocketServer) ──────────────────────────────────

describe('websocket server integration', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let port: number;

  before(async () => {
    await seedOrg();

    server = http.createServer();
    wss = new WebSocketServer({ server });
    setupWebSocket(wss);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  after(async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it('rejects connection with no token (code 4001)', async () => {
    const code = await waitForClose(port);
    assert.equal(code, 4001);
  });

  it('device token connects successfully', async () => {
    const token = await makeDeviceToken();
    const client = await connectWsClient(port, token);
    assert.equal(client.ws.readyState, WebSocket.OPEN);
    await client.close();
  });

  it('admin token connects and receives presence:snapshot immediately', async () => {
    const token = makeDashboardToken();
    const admin = await connectWsClient(port, token);
    const msg = await admin.nextMessage() as any;
    assert.equal(msg.type, 'presence:snapshot');
    assert.ok(Array.isArray(msg.data.employees));
    await admin.close();
  });

  it('device "register" → admin sees employee:online', async () => {
    const devToken = await makeDeviceToken();
    const admToken = makeDashboardToken();

    // Connect admin first — drain the initial snapshot
    const admin = await connectWsClient(port, admToken);
    const snapshot = await admin.nextMessage() as any;
    assert.equal(snapshot.type, 'presence:snapshot');

    // Connect device — wait for server auth to complete before sending messages.
    // Device tokens require an async DB lookup; the `message` handler is only
    // registered AFTER auth, so we poll until the client appears in the map.
    const dev = await connectWsClient(port, devToken);
    await waitForEmployeeReady(ORG_ID, EMP_ID);
    dev.ws.send(JSON.stringify({ type: 'register', employeeName: 'WS Employee' }));

    const onlineMsg = await admin.nextMessage() as any;
    assert.equal(onlineMsg.type, 'employee:online');
    assert.equal(onlineMsg.data.employeeId, EMP_ID);
    assert.equal(onlineMsg.data.employeeName, 'WS Employee');

    // Verify helper reflects live state
    assert.equal(isEmployeeOnline(ORG_ID, EMP_ID), true);

    // Close device — admin should receive employee:offline
    await dev.close();
    const offlineMsg = await admin.nextMessage() as any;
    assert.equal(offlineMsg.type, 'employee:offline');
    assert.equal(offlineMsg.data.employeeId, EMP_ID);

    await admin.close();
  });

  it('admin register refreshes presence:snapshot', async () => {
    const admToken = makeDashboardToken();
    const admin = await connectWsClient(port, admToken);

    // Drain the initial snapshot
    await admin.nextMessage();

    // Send register as admin → should get another presence:snapshot
    admin.ws.send(JSON.stringify({ type: 'register', employeeName: 'Admin User' }));
    const msg = await admin.nextMessage() as any;
    assert.equal(msg.type, 'presence:snapshot');
    assert.ok(Array.isArray(msg.data.employees));

    await admin.close();
  });
});

after(() => cleanupTestEnv(testEnv));
