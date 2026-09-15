#!/usr/bin/env node
/**
 * Archtrack conformance smoke test.
 * Run against a live admin server: node scripts/conformance.mjs
 * Uses the enrolled desktop device token from macOS Application Support.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminRoot = path.resolve(__dirname, '..');

// Load server auth helpers (same JWT secret as the running server).
const { verifyToken, generateDashboardToken } = await import(
  path.join(adminRoot, 'server/auth.ts')
).catch(async () => {
  // Fallback when executed via tsx/node with compiled dist
  return await import(path.join(adminRoot, 'dist/server/auth.js'));
});

const BASE = process.env.ARCHTRACK_URL || 'http://127.0.0.1:3001';
const WS_BASE = BASE.replace(/^http/, 'ws');

const results = [];
function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

function loadDeviceToken() {
  const p = path.join(
    os.homedir(),
    'Library/Application Support/@teamtracker/desktop/config.json'
  );
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!cfg.deviceToken) throw new Error('No deviceToken in desktop config');
  return cfg;
}

async function waitOpen(ws, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS open timeout')), ms);
    ws.once('open', () => { clearTimeout(t); resolve(); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

async function waitFor(ws, type, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), ms);
    const onMsg = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === type) {
          clearTimeout(t);
          ws.off('message', onMsg);
          resolve(msg);
        }
      } catch { /* ignore */ }
    };
    ws.on('message', onMsg);
  });
}

console.log(`\nArchtrack conformance @ ${BASE}\n`);

// 1) Health
{
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json();
  if (res.ok && body.status === 'ok') pass('health', `${body.employees} employees`);
  else fail('health', JSON.stringify(body));
}

const deviceCfg = loadDeviceToken();
const devicePayload = verifyToken(deviceCfg.deviceToken);
pass('device token valid', devicePayload.employeeId);

const adminToken = generateDashboardToken({
  userId: 'conformance-admin',
  orgId: devicePayload.orgId,
  email: 'conformance@local',
});

// 2) Device WS stays open
{
  const ws = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(deviceCfg.deviceToken)}`);
  try {
    await waitOpen(ws);
    ws.send(JSON.stringify({ type: 'register', employeeName: deviceCfg.employeeName || 'Employee' }));
    await new Promise((r) => setTimeout(r, 800));
    if (ws.readyState === WebSocket.OPEN) pass('device websocket stable');
    else fail('device websocket stable', `readyState=${ws.readyState}`);
    ws.close();
  } catch (e) {
    fail('device websocket stable', e.message);
  }
}

// 3) Admin presence snapshot includes device (device must already be connected —
//    connect a short-lived device first if needed)
{
  const deviceWs = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(deviceCfg.deviceToken)}`);
  await waitOpen(deviceWs);
  deviceWs.send(JSON.stringify({ type: 'register', employeeName: deviceCfg.employeeName || 'waleed' }));
  await new Promise((r) => setTimeout(r, 300));

  const adminWs = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(adminToken)}`);
  try {
    const snapPromise = waitFor(adminWs, 'presence:snapshot', 5000);
    await waitOpen(adminWs);
    const snap = await snapPromise;
    const ids = (snap.data?.employees || []).map((e) => e.employeeId);
    if (ids.includes(devicePayload.employeeId)) {
      pass('presence snapshot includes live tracker');
    } else {
      fail('presence snapshot includes live tracker', `got ${JSON.stringify(ids)}`);
    }
  } catch (e) {
    fail('presence snapshot includes live tracker', e.message);
  } finally {
    adminWs.close();
    deviceWs.close();
  }
}

// 4) HTTP online endpoint
{
  // Keep a device socket open during the check
  const deviceWs = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(deviceCfg.deviceToken)}`);
  await waitOpen(deviceWs);
  deviceWs.send(JSON.stringify({ type: 'register', employeeName: 'waleed' }));
  await new Promise((r) => setTimeout(r, 200));

  const res = await fetch(`${BASE}/api/employees/online`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const body = await res.json();
  const ids = (body.data || []).map((e) => e.employeeId);
  if (res.ok && body.success && ids.includes(devicePayload.employeeId)) {
    pass('GET /api/employees/online', `${ids.length} online`);
  } else {
    fail('GET /api/employees/online', JSON.stringify(body));
  }
  deviceWs.close();
}

// 5) On-demand screenshot against the REAL running desktop tracker if online,
//    otherwise against a temporary device socket (command delivered but capture
//    won't upload without Electron). Prefer real device via online list.
{
  const onlineRes = await fetch(`${BASE}/api/employees/online`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const onlineBody = await onlineRes.json();
  const live = (onlineBody.data || []).find((e) => e.employeeId === devicePayload.employeeId);

  if (!live) {
    fail('on-demand screenshot', 'tracker not online — start desktop app and re-run');
  } else {
    const adminWs = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(adminToken)}`);
    const shotPromise = waitFor(adminWs, 'screenshot:new', 15000);
    await waitOpen(adminWs);
    adminWs.send(JSON.stringify({ type: 'register', employeeName: 'Admin' }));

    const res = await fetch(`${BASE}/api/screenshots/request`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ employeeId: devicePayload.employeeId }),
    });
    const body = await res.json();
    if (!res.ok || !body.success) {
      fail('on-demand screenshot request', JSON.stringify(body));
      adminWs.close();
    } else {
      pass('on-demand screenshot request', body.data.requestId);
      try {
        const shot = await shotPromise;
        pass('on-demand screenshot uploaded', shot.data?.id || shot.data?.fileUrl);
      } catch (e) {
        fail('on-demand screenshot uploaded', e.message);
      }
      adminWs.close();
    }
  }
}

// 6) Org settings readable by device (screenshot policy poll)
{
  const res = await fetch(`${BASE}/api/organization`, {
    headers: { Authorization: `Bearer ${deviceCfg.deviceToken}` },
  });
  const body = await res.json();
  if (res.ok && body.success) pass('device can read org settings');
  else fail('device can read org settings', JSON.stringify(body));
}

// 7) Screenshots list
{
  const res = await fetch(`${BASE}/api/screenshots?limit=5`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const body = await res.json();
  if (res.ok && body.success) pass('screenshots list', `${(body.data || []).length} rows`);
  else fail('screenshots list', JSON.stringify(body));
}

// 8) i18n dictionaries parity (static)
{
  const translationsPath = path.join(adminRoot, 'src/client/i18n/translations.ts');
  const src = fs.readFileSync(translationsPath, 'utf8');
  const enBlock = src.match(/export const en = \{([\s\S]*?)\} as const;/);
  const arBlock = src.match(/export const ar: Record<TranslationKey, string> = \{([\s\S]*?)\};/);
  const keys = (block) => [...block[1].matchAll(/'([^']+)':/g)].map((m) => m[1]);
  const enKeys = keys(enBlock);
  const arKeys = keys(arBlock);
  const missing = enKeys.filter((k) => !arKeys.includes(k));
  if (missing.length === 0) pass('i18n en/ar key parity', `${enKeys.length} keys`);
  else fail('i18n en/ar key parity', `missing ${missing.join(', ')}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('Failed:');
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log('All conformance checks passed.\n');
