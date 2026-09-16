import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import { randomUUID } from 'crypto';
import { createTimeEntry, updateTimeEntry, createActivity, getActivityById, updateActivity } from './database.js';
import { verifyToken, assertDeviceAccess, type DeviceTokenPayload } from './auth.js';
import {
  enqueueRemoteCommand,
  markCommandDelivered,
  type PendingRemoteCommand,
} from './remote-commands.js';

interface ConnectedClient {
  ws: WebSocket;
  employeeId?: string;
  employeeName?: string;
  isAdmin?: boolean;
  orgId?: string;
  tokenType?: 'dashboard' | 'device';
}

/** One live screen session: admin watches one employee; frames relay only to that admin. */
interface LiveViewSession {
  sessionId: string;
  orgId: string;
  employeeId: string;
  adminWs: WebSocket;
}

const clients = new Map<WebSocket, ConnectedClient>();
/** admin socket → session */
const liveByAdmin = new Map<WebSocket, LiveViewSession>();
/** employeeId → session (at most one viewer per employee) */
const liveByEmployee = new Map<string, LiveViewSession>();

const MAX_LIVE_FRAME_CHARS = 350_000; // ~260KB jpeg base64

export function setupWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req: any) => {
    console.log('🔌 New WebSocket connection');

    void (async () => {
    let orgId: string | undefined;
    let employeeId: string | undefined;
    let isAdmin = false;
    let tokenType: 'dashboard' | 'device' | undefined;

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(4001, 'Authentication required: no token provided');
        return;
      }
      const payload = verifyToken(token);
      orgId = payload.orgId;
      if (payload.type === 'device') {
        const access = await assertDeviceAccess(payload as DeviceTokenPayload);
        if (!access.ok) {
          ws.close(4003, access.error);
          return;
        }
        employeeId = payload.employeeId;
        isAdmin = false;
        tokenType = 'device';
      } else if (payload.type === 'dashboard') {
        employeeId = payload.userId;
        isAdmin = true;
        tokenType = 'dashboard';
      } else {
        ws.close(4002, 'Authentication failed: unsupported token type');
        return;
      }
    } catch (err) {
      console.warn('WebSocket auth failed:', (err as Error).message);
      ws.close(4002, 'Authentication failed: invalid or expired token');
      return;
    }

    clients.set(ws, { ws, orgId, employeeId, isAdmin, tokenType });

    // Admins get an immediate presence snapshot so already-connected
    // trackers appear Online without waiting for a later register event.
    if (isAdmin && orgId) {
      const online = getConnectedEmployees(orgId).map(e => ({
        employeeId: e.employeeId,
        employeeName: e.employeeName,
        timestamp: new Date().toISOString(),
      }));
      try {
        ws.send(JSON.stringify({
          type: 'presence:snapshot',
          data: { employees: online },
        }));
      } catch { /* ignore */ }
    }

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(ws, message);
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      const client = clients.get(ws);
      // End any live-view this admin was watching (stops device streaming).
      if (client?.isAdmin) {
        endLiveViewForAdmin(ws, 'admin-disconnect');
      }
      // If a device disconnects mid-stream, notify its viewer.
      if (client && !client.isAdmin && client.employeeId) {
        const session = liveByEmployee.get(client.employeeId);
        if (session) {
          endLiveViewSession(session, 'device-disconnect');
        }
      }
      // Only broadcast offline for device trackers — dashboard admins also
      // have an employeeId (userId) and must not clear live presence.
      if (client && !client.isAdmin && client.employeeId && client.orgId) {
        broadcastToAdmins(client.orgId, {
          type: 'employee:offline',
          data: {
            employeeId: client.employeeId,
            employeeName: client.employeeName,
            timestamp: new Date().toISOString()
          }
        });
      }
      clients.delete(ws);
      console.log('🔌 WebSocket disconnected');
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
    })();
  });
}

async function handleMessage(ws: WebSocket, message: any): Promise<void> {
  const client = clients.get(ws);
  if (!client) return;

  switch (message.type) {
    case 'register':
      client.employeeName = message.employeeName;
      console.log(`👤 ${client.employeeName} (${client.employeeId}) registered [org: ${client.orgId}]`);

      if (!client.isAdmin && client.orgId && client.employeeId) {
        broadcastToAdmins(client.orgId, {
          type: 'employee:online',
          data: {
            employeeId: client.employeeId,
            employeeName: client.employeeName,
            timestamp: new Date().toISOString()
          }
        });
      }

      // Admins joining mid-session never saw earlier employee:online events.
      // Push a full presence snapshot so the dashboard matches live devices.
      if (client.isAdmin && client.orgId) {
        const online = getConnectedEmployees(client.orgId).map(e => ({
          employeeId: e.employeeId,
          employeeName: e.employeeName,
          timestamp: new Date().toISOString(),
        }));
        ws.send(JSON.stringify({
          type: 'presence:snapshot',
          data: { employees: online },
        }));
      }
      break;

    case 'time-entry:started':
      console.log(`⏱️ ${client.employeeName} started tracking`);
      try {
        await createTimeEntry(client.orgId!, message.entry);
      } catch (err) {
        console.error('Error saving time entry:', err);
      }
      broadcastToAdmins(client.orgId!, {
        type: 'time-entry:started',
        data: {
          employeeId: client.employeeId,
          employeeName: client.employeeName,
          entry: message.entry,
          timestamp: new Date().toISOString()
        }
      });
      break;

    case 'time-entry:stopped':
      console.log(`⏹️ ${client.employeeName} stopped tracking`);
      try {
        await updateTimeEntry(client.orgId!, message.entry.id, {
          endTime: message.entry.endTime,
          duration: message.entry.duration,
          idleTime: message.entry.idleTime
        });
      } catch (err) {
        console.error('Error updating time entry:', err);
      }
      broadcastToAdmins(client.orgId!, {
        type: 'time-entry:stopped',
        data: {
          employeeId: client.employeeId,
          employeeName: client.employeeName,
          entry: message.entry,
          timestamp: new Date().toISOString()
        }
      });
      break;

    case 'time-entries':
      console.log(`📤 ${client.employeeName} synced ${message.entries?.length || 0} activities`);

      if (message.entries && Array.isArray(message.entries)) {
        let successCount = 0;
        let errorCount = 0;
        let lastError: string | null = null;

        for (const entry of message.entries) {
          try {
            // Device tokens may only write their own employee activities
            const entryEmployeeId =
              client.tokenType === 'device' ? client.employeeId : entry.employeeId;
            if (!entryEmployeeId) {
              errorCount++;
              lastError = 'Missing employeeId';
              continue;
            }
            const safeEntry = { ...entry, employeeId: entryEmployeeId };
            const existing = await getActivityById(client.orgId!, safeEntry.id);
            if (existing) {
              await updateActivity(client.orgId!, safeEntry.id, safeEntry);
            } else {
              await createActivity(client.orgId!, safeEntry);
            }
            successCount++;
          } catch (err: any) {
            console.error('Error syncing activity:', err);
            errorCount++;
            lastError = err.message || 'Unknown error';
          }
        }

        ws.send(JSON.stringify({
          type: 'sync:response',
          data: {
            success: errorCount === 0,
            successCount,
            errorCount,
            message: errorCount > 0
              ? `Synced ${successCount} activities, ${errorCount} failed. Last error: ${lastError}`
              : `Successfully synced ${successCount} activities`
          }
        }));

        if (successCount > 0) {
          broadcastToAdmins(client.orgId!, {
            type: 'sync:completed',
            data: {
              employeeId: client.employeeId,
              employeeName: client.employeeName,
              count: successCount,
              timestamp: new Date().toISOString()
            }
          });
        }
      }
      break;

    case 'admin:request-sync':
      if (client.isAdmin && client.orgId) {
        broadcastToEmployees(client.orgId, {
          type: 'sync-request',
          data: { requestedBy: client.employeeId }
        });
      }
      break;

    case 'admin:ping-employee':
      if (client.isAdmin && client.orgId && message.employeeId) {
        const targetClient = findClientByEmployeeId(client.orgId, message.employeeId);
        ws.send(JSON.stringify({
          type: 'admin:employee-status',
          data: {
            employeeId: message.employeeId,
            isOnline: !!targetClient,
            timestamp: new Date().toISOString()
          }
        }));
      }
      break;

    case 'admin:request-screenshot': {
      if (!client.isAdmin || !client.orgId || !message.employeeId) break;
      const result = requestScreenshotCommand({
        orgId: client.orgId,
        employeeId: message.employeeId,
        requestedBy: client.employeeId || 'admin',
      });
      ws.send(JSON.stringify({
        type: 'admin:screenshot-requested',
        data: result,
      }));
      break;
    }

    case 'admin:live-view-start': {
      if (!client.isAdmin || !client.orgId || !message.employeeId) break;
      const result = startLiveView({
        adminWs: ws,
        orgId: client.orgId,
        employeeId: String(message.employeeId),
      });
      ws.send(JSON.stringify({
        type: 'admin:live-view-status',
        data: result,
      }));
      break;
    }

    case 'admin:live-view-stop': {
      if (!client.isAdmin) break;
      endLiveViewForAdmin(ws, 'admin-stop');
      ws.send(JSON.stringify({
        type: 'admin:live-view-status',
        data: { active: false },
      }));
      break;
    }

    case 'live-view:frame': {
      if (client.isAdmin || !client.employeeId || !client.orgId) break;
      const session = liveByEmployee.get(client.employeeId);
      if (!session || session.orgId !== client.orgId) break;
      if (message.data?.sessionId && message.data.sessionId !== session.sessionId) break;
      const privacyBlocked = !!message.data?.privacyBlocked;
      const dataBase64 = typeof message.data?.dataBase64 === 'string' ? message.data.dataBase64 : '';
      if (!privacyBlocked) {
        if (!dataBase64 || dataBase64.length > MAX_LIVE_FRAME_CHARS) break;
      }
      if (session.adminWs.readyState !== WebSocket.OPEN) {
        endLiveViewSession(session, 'viewer-gone');
        break;
      }
      session.adminWs.send(JSON.stringify({
        type: 'live-view:frame',
        data: {
          sessionId: session.sessionId,
          employeeId: client.employeeId,
          mimeType: message.data?.mimeType || 'image/jpeg',
          dataBase64: privacyBlocked ? '' : dataBase64,
          capturedAt: message.data?.capturedAt || new Date().toISOString(),
          privacyBlocked,
          appName: message.data?.appName || null,
          windowTitle: message.data?.windowTitle || null,
        },
      }));
      break;
    }

    case 'screenshot:privacy-blocked': {
      if (client.isAdmin || !client.employeeId || !client.orgId) break;
      broadcastToAdmins(client.orgId, {
        type: 'screenshot:privacy-blocked',
        data: {
          employeeId: client.employeeId,
          employeeName: client.employeeName,
          requestId: message.data?.requestId || null,
          appName: message.data?.appName || null,
          windowTitle: message.data?.windowTitle || null,
          pattern: message.data?.pattern || null,
          timestamp: new Date().toISOString(),
        },
      });
      break;
    }

    case 'live-view:ended': {
      if (client.isAdmin || !client.employeeId) break;
      const session = liveByEmployee.get(client.employeeId);
      if (!session) break;
      if (session.adminWs.readyState === WebSocket.OPEN) {
        session.adminWs.send(JSON.stringify({
          type: 'live-view:ended',
          data: {
            sessionId: session.sessionId,
            employeeId: client.employeeId,
            reason: message.data?.reason || 'device-ended',
          },
        }));
      }
      liveByAdmin.delete(session.adminWs);
      liveByEmployee.delete(client.employeeId);
      break;
    }
  }
}

function startLiveView(input: {
  adminWs: WebSocket;
  orgId: string;
  employeeId: string;
}): { active: boolean; online: boolean; delivered: boolean; sessionId?: string; error?: string } {
  // Stop this admin's previous session first (only one employee streams at a time per admin).
  endLiveViewForAdmin(input.adminWs, 'switched');

  const target = findClientByEmployeeId(input.orgId, input.employeeId);
  if (!target || target.ws.readyState !== WebSocket.OPEN) {
    return { active: false, online: false, delivered: false, error: 'Employee tracker is offline' };
  }

  // If another admin is already watching this employee, take over and notify them.
  const existing = liveByEmployee.get(input.employeeId);
  if (existing && existing.adminWs !== input.adminWs) {
    endLiveViewSession(existing, 'taken-over');
  }

  const sessionId = randomUUID();
  const session: LiveViewSession = {
    sessionId,
    orgId: input.orgId,
    employeeId: input.employeeId,
    adminWs: input.adminWs,
  };
  liveByAdmin.set(input.adminWs, session);
  liveByEmployee.set(input.employeeId, session);

  try {
    target.ws.send(JSON.stringify({
      type: 'command:live-view-start',
      data: { sessionId, employeeId: input.employeeId },
    }));
  } catch {
    endLiveViewSession(session, 'deliver-failed');
    return { active: false, online: true, delivered: false, error: 'Failed to reach device' };
  }

  console.log(`📺 Live view started: employee=${input.employeeId} session=${sessionId}`);
  return { active: true, online: true, delivered: true, sessionId };
}

function endLiveViewForAdmin(adminWs: WebSocket, reason: string): void {
  const session = liveByAdmin.get(adminWs);
  if (session) endLiveViewSession(session, reason);
}

function endLiveViewSession(session: LiveViewSession, reason: string): void {
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

  console.log(`📺 Live view ended: employee=${session.employeeId} reason=${reason}`);
}

function commandPayload(cmd: PendingRemoteCommand) {
  return {
    type: 'command:screenshot',
    data: {
      requestId: cmd.id,
      type: cmd.type,
      expiresAt: new Date(cmd.expiresAt).toISOString(),
    },
  };
}

/** Enqueue + push screenshot command to a live device if connected. */
export function requestScreenshotCommand(input: {
  orgId: string;
  employeeId: string;
  requestedBy: string;
}): { requestId: string; online: boolean; delivered: boolean } {
  const cmd = enqueueRemoteCommand({
    type: 'screenshot',
    orgId: input.orgId,
    employeeId: input.employeeId,
    requestedBy: input.requestedBy,
  });

  const target = findClientByEmployeeId(input.orgId, input.employeeId);
  let delivered = false;
  if (target && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(JSON.stringify(commandPayload(cmd)));
    markCommandDelivered(cmd.id);
    delivered = true;
  }

  return { requestId: cmd.id, online: !!target, delivered };
}

export function broadcastScreenshotNew(orgId: string, data: Record<string, unknown>): void {
  broadcastToAdmins(orgId, {
    type: 'screenshot:new',
    data: {
      ...data,
      timestamp: new Date().toISOString(),
    },
  });
}

function broadcastToAdmins(orgId: string, message: any): void {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.isAdmin && client.orgId === orgId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  });
}

function broadcastToEmployees(orgId: string, message: any): void {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (
      !client.isAdmin &&
      client.orgId === orgId &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      client.ws.send(data);
    }
  });
}

function findClientByEmployeeId(orgId: string, employeeId: string): ConnectedClient | undefined {
  for (const client of clients.values()) {
    if (
      !client.isAdmin &&
      client.orgId === orgId &&
      client.employeeId === employeeId &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      return client;
    }
  }
  return undefined;
}

export function isEmployeeOnline(orgId: string, employeeId: string): boolean {
  return !!findClientByEmployeeId(orgId, employeeId);
}

export function getConnectedEmployees(orgId?: string): Array<{ employeeId: string; employeeName: string; orgId?: string }> {
  const employees: Array<{ employeeId: string; employeeName: string; orgId?: string }> = [];
  clients.forEach((client) => {
    if (client.employeeId && !client.isAdmin) {
      if (orgId && client.orgId !== orgId) return;
      employees.push({
        employeeId: client.employeeId,
        employeeName: client.employeeName || 'Unknown',
        orgId: client.orgId,
      });
    }
  });
  return employees;
}
