import { WebSocketServer, WebSocket } from 'ws';
import { clients, liveByEmployee, broadcastToAdmins, getConnectedEmployees } from './clients.js';
import { authenticateConnection } from './auth.js';
import { toBuffer, handleBinaryLiveFrame, endLiveViewForAdmin, endLiveViewSession } from './live-view.js';
import { handleMessage } from './message-router.js';
import { peekLiveViewBinaryMagic } from '../../shared/live-view/index.js';
import { wsLog } from './log.js';
import { endAutomationForEmployee } from '../screenshot-automation.js';

export function setupWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req: any) => {
    wsLog('🔌 New WebSocket connection');

    void (async () => {
      const auth = await authenticateConnection(req);

      if (!auth.ok) {
        ws.close(auth.code, auth.message);
        return;
      }

      const { orgId, employeeId, isAdmin, tokenType } = auth;

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

      ws.on('message', async (data: WebSocket.RawData, isBinary: boolean) => {
        try {
          const buf = toBuffer(data);
          if (isBinary || peekLiveViewBinaryMagic(buf)) {
            handleBinaryLiveFrame(ws, buf);
            return;
          }
          const message = JSON.parse(buf.toString('utf8'));
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
          // Stop any recurring screenshot automation for this employee.
          endAutomationForEmployee(client.employeeId, 'device-disconnect');
        }
        // Only broadcast offline for device trackers — dashboard admins also
        // have an employeeId (userId) and must not clear live presence.
        if (client && !client.isAdmin && client.employeeId && client.orgId) {
          broadcastToAdmins(client.orgId, {
            type: 'employee:offline',
            data: {
              employeeId: client.employeeId,
              employeeName: client.employeeName,
              timestamp: new Date().toISOString(),
            },
          });
        }
        clients.delete(ws);
        wsLog('🔌 WebSocket disconnected');
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err);
      });
    })();
  });
}
