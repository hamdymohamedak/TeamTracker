import { WebSocket } from 'ws';
import {
  enqueueRemoteCommand,
  markCommandDelivered,
  type PendingRemoteCommand,
} from '../remote-commands.js';
import { broadcastToAdmins, findClientByEmployeeId } from './clients.js';

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
