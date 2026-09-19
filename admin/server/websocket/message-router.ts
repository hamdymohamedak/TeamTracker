import { WebSocket } from 'ws';
import { parseLiveViewQualityMode } from '../../shared/live-view/index.js';
import { clients, liveByAdmin, liveByEmployee, broadcastToAdmins, broadcastToEmployees, findClientByEmployeeId, getConnectedEmployees } from './clients.js';
import {
  handleTimeEntryStarted,
  handleTimeEntryStopped,
  handleTimeEntriesSync,
} from './sync-handlers.js';
import {
  MAX_LIVE_FRAME_CHARS,
  relayLiveViewSignal,
  startLiveView,
  endLiveViewForAdmin,
  endLiveViewSession,
} from './live-view.js';
import { requestScreenshotCommand } from './remote-commands.js';
import { wsLog } from './log.js';

export async function handleMessage(ws: WebSocket, message: any): Promise<void> {
  const client = clients.get(ws);
  if (!client) return;

  switch (message.type) {
    case 'register':
      client.employeeName = message.employeeName;
      wsLog(`👤 ${client.employeeName} (${client.employeeId}) registered [org: ${client.orgId}]`);

      if (!client.isAdmin && client.orgId && client.employeeId) {
        broadcastToAdmins(client.orgId, {
          type: 'employee:online',
          data: {
            employeeId: client.employeeId,
            employeeName: client.employeeName,
            timestamp: new Date().toISOString(),
          },
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
      await handleTimeEntryStarted(ws, message);
      break;

    case 'time-entry:stopped':
      await handleTimeEntryStopped(ws, message);
      break;

    case 'time-entries':
      await handleTimeEntriesSync(ws, message);
      break;

    case 'admin:request-sync':
      if (client.isAdmin && client.orgId) {
        broadcastToEmployees(client.orgId, {
          type: 'sync-request',
          data: { requestedBy: client.employeeId },
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
            timestamp: new Date().toISOString(),
          },
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
        quality: message.quality ?? message.data?.quality,
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

    case 'admin:live-view-quality': {
      if (!client.isAdmin || !client.orgId) break;
      const session = liveByAdmin.get(ws);
      if (!session || session.orgId !== client.orgId) break;
      const quality = parseLiveViewQualityMode(
        message.quality ?? message.data?.quality,
        session.quality
      );
      session.quality = quality;
      const device = findClientByEmployeeId(session.orgId, session.employeeId);
      const incoming = message.data && typeof message.data === 'object' ? message.data : {};
      const qualityData = {
        ...incoming,
        sessionId: session.sessionId,
        quality,
      };
      if (device && device.ws.readyState === WebSocket.OPEN) {
        device.ws.send(JSON.stringify({
          type: 'command:live-view-quality',
          data: qualityData,
        }));
      }
      ws.send(JSON.stringify({
        type: 'admin:live-view-status',
        data: {
          active: true,
          sessionId: session.sessionId,
          quality,
          qualityUpdated: true,
        },
      }));
      wsLog(`[live_view] quality_changed session=${session.sessionId} quality=${quality}`);
      break;
    }

    case 'admin:live-view-signal': {
      if (!client.isAdmin || !client.orgId) break;
      relayLiveViewSignal({
        fromAdmin: true,
        ws,
        orgId: client.orgId,
        sessionId: String(message.data?.sessionId || message.sessionId || ''),
        signal: message.data?.signal ?? message.signal,
      });
      break;
    }

    case 'live-view:signal': {
      if (client.isAdmin || !client.employeeId || !client.orgId) break;
      relayLiveViewSignal({
        fromAdmin: false,
        ws,
        orgId: client.orgId,
        employeeId: client.employeeId,
        sessionId: String(message.data?.sessionId || ''),
        signal: message.data?.signal,
      });
      break;
    }

    case 'live-view:transport': {
      if (!client.orgId) break;
      const session = client.isAdmin
        ? liveByAdmin.get(ws)
        : client.employeeId
          ? liveByEmployee.get(client.employeeId)
          : undefined;
      if (!session || session.orgId !== client.orgId) break;
      if (message.data?.sessionId && message.data.sessionId !== session.sessionId) break;
      const payload = {
        type: 'live-view:transport',
        data: {
          sessionId: session.sessionId,
          employeeId: session.employeeId,
          transport: message.data?.transport || null,
          state: message.data?.state || null,
          reason: message.data?.reason || null,
          from: client.isAdmin ? 'admin' : 'device',
        },
      };
      // Notify the peer (admin ↔ device).
      if (client.isAdmin) {
        const device = findClientByEmployeeId(session.orgId, session.employeeId);
        if (device?.ws.readyState === WebSocket.OPEN) {
          device.ws.send(JSON.stringify(payload));
        }
      } else if (session.adminWs.readyState === WebSocket.OPEN) {
        session.adminWs.send(JSON.stringify(payload));
      }
      break;
    }

    case 'live-view:context': {
      // Device → admin: focused app label for the Live Activity sidebar.
      if (client.isAdmin || !client.employeeId || !client.orgId) break;
      const session = liveByEmployee.get(client.employeeId);
      if (!session || session.orgId !== client.orgId) break;
      if (message.data?.sessionId && message.data.sessionId !== session.sessionId) break;
      if (session.adminWs.readyState !== WebSocket.OPEN) break;
      session.adminWs.send(JSON.stringify({
        type: 'live-view:context',
        data: {
          sessionId: session.sessionId,
          employeeId: client.employeeId,
          appName: message.data?.appName || null,
          windowTitle: message.data?.windowTitle || null,
          label: message.data?.label || null,
          capturedAt: message.data?.capturedAt || new Date().toISOString(),
        },
      }));
      break;
    }

    case 'live-view:frame': {
      // Legacy Base64 JSON path — still accepted for older desktop builds.
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
          pattern: message.data?.pattern || null,
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
