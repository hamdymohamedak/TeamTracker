import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import {
  LIVE_VIEW_BINARY_HEADER_SIZE,
  peekBinaryPayloadLength,
  peekBinarySessionId,
  peekLiveViewBinaryMagic,
  parseLiveViewQualityMode,
  type LiveViewQualityMode,
} from '../../shared/live-view/index.js';
import { getLiveViewEnv, liveViewStartPayload } from '../live-view-config.js';
import { clients, liveByAdmin, liveByEmployee, findClientByEmployeeId } from './clients.js';
import type { LiveViewSession } from './types.js';
import { wsLog } from './log.js';

/** Legacy Base64 JSON frame cap (compatibility only). */
export const MAX_LIVE_FRAME_CHARS = 350_000;

export function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data as Uint8Array);
}

/**
 * Efficient binary relay: validate magic + size + session ownership, then
 * forward raw bytes (no JPEG decode / Base64 / JSON round-trip).
 */
export function handleBinaryLiveFrame(ws: WebSocket, buf: Buffer): void {
  const client = clients.get(ws);
  if (!client || client.isAdmin || !client.employeeId || !client.orgId) return;
  if (!peekLiveViewBinaryMagic(buf)) return;

  const cfg = getLiveViewEnv();
  if (buf.byteLength > LIVE_VIEW_BINARY_HEADER_SIZE + cfg.maxFrameBytes) return;

  const payloadLen = peekBinaryPayloadLength(buf);
  if (payloadLen == null || payloadLen > cfg.maxFrameBytes) return;
  if (buf.byteLength !== LIVE_VIEW_BINARY_HEADER_SIZE + payloadLen) return;

  const sessionId = peekBinarySessionId(buf);
  if (!sessionId) return;

  const session = liveByEmployee.get(client.employeeId);
  if (!session || session.orgId !== client.orgId) return;
  if (session.sessionId !== sessionId) return;

  if (session.adminWs.readyState !== WebSocket.OPEN) {
    endLiveViewSession(session, 'viewer-gone');
    return;
  }
  try {
    session.adminWs.send(buf, { binary: true });
  } catch {
    endLiveViewSession(session, 'deliver-failed');
  }
}

export function relayLiveViewSignal(input: {
  fromAdmin: boolean;
  ws: WebSocket;
  orgId: string;
  employeeId?: string;
  sessionId: string;
  signal: unknown;
}): void {
  if (!input.sessionId || !input.signal || typeof input.signal !== 'object') return;

  let session: LiveViewSession | undefined;
  if (input.fromAdmin) {
    session = liveByAdmin.get(input.ws);
  } else if (input.employeeId) {
    session = liveByEmployee.get(input.employeeId);
  }
  if (!session || session.orgId !== input.orgId) return;
  if (session.sessionId !== input.sessionId) return;

  const envelope = {
    type: input.fromAdmin ? 'command:live-view-signal' : 'live-view:signal',
    data: {
      sessionId: session.sessionId,
      employeeId: session.employeeId,
      signal: input.signal,
    },
  };

  if (input.fromAdmin) {
    const device = findClientByEmployeeId(session.orgId, session.employeeId);
    if (device && device.ws.readyState === WebSocket.OPEN) {
      device.ws.send(JSON.stringify(envelope));
    }
  } else if (session.adminWs.readyState === WebSocket.OPEN) {
    session.adminWs.send(JSON.stringify(envelope));
  }
}

export function startLiveView(input: {
  adminWs: WebSocket;
  orgId: string;
  employeeId: string;
  quality?: unknown;
}): {
  active: boolean;
  online: boolean;
  delivered: boolean;
  sessionId?: string;
  quality?: LiveViewQualityMode;
  webrtcEnabled?: boolean;
  wsFallbackEnabled?: boolean;
  maxFrameBytes?: number;
  iceServers?: ReturnType<typeof liveViewStartPayload>['iceServers'];
  autoConfig?: ReturnType<typeof liveViewStartPayload>['autoConfig'];
  error?: string;
} {
  endLiveViewForAdmin(input.adminWs, 'switched');

  const target = findClientByEmployeeId(input.orgId, input.employeeId);
  if (!target || target.ws.readyState !== WebSocket.OPEN) {
    return { active: false, online: false, delivered: false, error: 'Employee tracker is offline' };
  }

  const existing = liveByEmployee.get(input.employeeId);
  if (existing && existing.adminWs !== input.adminWs) {
    endLiveViewSession(existing, 'taken-over');
  }

  const startOpts = liveViewStartPayload(input.orgId, input.quality);
  const sessionId = randomUUID();
  const session: LiveViewSession = {
    sessionId,
    orgId: input.orgId,
    employeeId: input.employeeId,
    adminWs: input.adminWs,
    quality: startOpts.quality,
  };
  liveByAdmin.set(input.adminWs, session);
  liveByEmployee.set(input.employeeId, session);

  try {
    target.ws.send(JSON.stringify({
      type: 'command:live-view-start',
      data: {
        sessionId,
        employeeId: input.employeeId,
        ...startOpts,
      },
    }));
  } catch {
    endLiveViewSession(session, 'deliver-failed');
    return { active: false, online: true, delivered: false, error: 'Failed to reach device' };
  }

  wsLog(
    `[live_view] live_view_started employee=${input.employeeId} session=${sessionId} quality=${startOpts.quality}`
  );
  return {
    active: true,
    online: true,
    delivered: true,
    sessionId,
    ...startOpts,
  };
}

export function endLiveViewForAdmin(adminWs: WebSocket, reason: string): void {
  const session = liveByAdmin.get(adminWs);
  if (session) endLiveViewSession(session, reason);
}

export function endLiveViewSession(session: LiveViewSession, reason: string): void {
  liveByAdmin.delete(session.adminWs);
  const current = liveByEmployee.get(session.employeeId);
  if (current?.sessionId === session.sessionId) {
    liveByEmployee.delete(session.employeeId);
  }

  const device = findClientByEmployeeId(session.orgId, session.employeeId);
  if (device && device.ws.readyState === WebSocket.OPEN) {
    try {
      device.ws.send(JSON.stringify({
        type: 'command:live-view-stop',
        data: { sessionId: session.sessionId, reason },
      }));
    } catch { /* ignore */ }
  }

  if (session.adminWs.readyState === WebSocket.OPEN) {
    try {
      session.adminWs.send(JSON.stringify({
        type: 'live-view:ended',
        data: {
          sessionId: session.sessionId,
          employeeId: session.employeeId,
          reason,
        },
      }));
    } catch { /* ignore */ }
  }

  wsLog(`📺 Live view ended: employee=${session.employeeId} reason=${reason}`);
}
