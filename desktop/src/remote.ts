// Desktop WebSocket client — presence, remote screenshots, live screen stream.
// Live frames are sent ONLY while an admin has started a live-view session.

import WebSocket from 'ws';
import { getEffectiveServerUrl } from './config.js';
import { captureNow, refreshOrgCapturePolicy } from './screenshot.js';
import {
  configureLiveViewSender,
  startLiveViewSession,
  stopLiveViewSession,
} from './live-view.js';

type GetToken = () => string;
type GetContext = () => { appName?: string; windowTitle?: string; employeeName?: string };

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let intentionalClose = false;
let reconnectAttempt = 0;
let getTokenFn: GetToken = () => '';
let getContextFn: GetContext = () => ({});
const inFlightRequests = new Set<string>();

function toWsUrl(httpUrl: string, token: string): string {
  const base = httpUrl.replace(/\/+$/, '');
  const wsBase = base.replace(/^http/, 'ws');
  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}

function sendMessage(message: Record<string, unknown>): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(message));
  } catch (err) {
    console.warn('[remote] send failed:', (err as Error).message);
  }
}

async function handleScreenshotCommand(requestId: string): Promise<void> {
  if (!requestId || inFlightRequests.has(requestId)) return;
  inFlightRequests.add(requestId);
  try {
    void refreshOrgCapturePolicy();
    console.log(`[remote] capturing screenshot for request ${requestId}`);
    const result = await captureNow(getTokenFn, () => ({
      appName: getContextFn().appName,
      windowTitle: getContextFn().windowTitle,
    }), { requestId, trigger: 'on_demand' });
    if (result.privacyBlocked) {
      console.log(`[remote] screenshot blocked by privacy rule "${result.privacyPattern}"`);
      sendMessage({
        type: 'screenshot:privacy-blocked',
        data: {
          requestId,
          appName: result.appName || null,
          windowTitle: result.windowTitle || null,
          pattern: result.privacyPattern || null,
        },
      });
    } else if (!result.ok) {
      console.warn(`[remote] screenshot request ${requestId} failed:`, result.error);
    } else {
      console.log(`[remote] screenshot uploaded for request ${requestId}:`, result.id);
    }
  } finally {
    inFlightRequests.delete(requestId);
  }
}

function handleMessage(raw: WebSocket.RawData): void {
  try {
    const message = JSON.parse(raw.toString());
    if (message?.type === 'command:screenshot' && message?.data?.requestId) {
      void handleScreenshotCommand(String(message.data.requestId));
    }
    if (message?.type === 'command:live-view-start' && message?.data?.sessionId) {
      // Start streaming immediately — privacy policy refresh must not delay first frames.
      void refreshOrgCapturePolicy();
      startLiveViewSession(String(message.data.sessionId));
    }
    if (message?.type === 'command:live-view-stop') {
      stopLiveViewSession('admin-stop');
    }
    if (message?.type === 'sync-request') {
      console.log('[remote] sync-request received (activity sync continues via HTTP)');
    }
  } catch (err) {
    console.warn('[remote] bad WS message:', (err as Error).message);
  }
}

async function pollCommands(): Promise<void> {
  const token = getTokenFn();
  if (!token) return;
  try {
    const res = await fetch(`${getEffectiveServerUrl()}/api/screenshots/commands`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const json = await res.json() as {
      success?: boolean;
      data?: Array<{ requestId: string; type: string }>;
    };
    if (!json.success || !Array.isArray(json.data)) return;
    for (const cmd of json.data) {
      if (cmd.type === 'screenshot' && cmd.requestId) {
        void handleScreenshotCommand(cmd.requestId);
      }
    }
  } catch {
    // ignore — next poll retries
  }
}

function scheduleReconnect(): void {
  if (intentionalClose) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  // Fast first reconnects after refresh (300ms → 5s cap), not 30s.
  const delay = Math.min(300 * Math.pow(2, reconnectAttempt), 5000);
  reconnectAttempt += 1;
  console.log(`[remote] reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
  reconnectTimer = setTimeout(() => connectSocket(), delay);
}

function connectSocket(): void {
  const token = getTokenFn();
  if (!token) {
    scheduleReconnect();
    return;
  }

  if (ws) {
    try {
      ws.removeAllListeners();
      // Avoid close→scheduleReconnect loop while we are intentionally replacing.
      ws.on('close', () => {});
      ws.close();
    } catch { /* ignore */ }
    ws = null;
  }

  const url = toWsUrl(getEffectiveServerUrl(), token);
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.warn('[remote] WS connect failed:', (err as Error).message);
    scheduleReconnect();
    return;
  }

  ws.on('open', () => {
    reconnectAttempt = 0;
    const name = getContextFn().employeeName || 'Employee';
    sendMessage({
      type: 'register',
      employeeName: name,
    });
    console.log('[remote] WebSocket connected');
    void pollCommands();
    // Pull privacy rules in the background — don't block live/screenshot.
    void refreshOrgCapturePolicy();
  });

  ws.on('message', handleMessage);

  ws.on('close', (code, reason) => {
    ws = null;
    stopLiveViewSession('ws-disconnect');
    if (!intentionalClose) {
      console.log(`[remote] WebSocket disconnected (${code} ${reason?.toString() || ''}) — reconnecting`);
      scheduleReconnect();
    }
  });

  ws.on('error', () => {
    // close handler schedules reconnect
  });
}

/**
 * Start presence + remote command channel. Safe to call once after enrollment.
 */
export function startRemoteCommandClient(
  getCurrentToken: GetToken,
  getCurrentContext: GetContext
): void {
  getTokenFn = getCurrentToken;
  getContextFn = getCurrentContext;
  intentionalClose = false;
  reconnectAttempt = 0;
  configureLiveViewSender(sendMessage, getCurrentContext);
  connectSocket();

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => void pollCommands(), 15_000);
}

export function stopRemoteCommandClient(): void {
  intentionalClose = true;
  stopLiveViewSession('client-stop');
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pollTimer) clearInterval(pollTimer);
  reconnectTimer = null;
  pollTimer = null;
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }
}
