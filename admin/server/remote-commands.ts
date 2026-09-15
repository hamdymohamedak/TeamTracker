// In-memory remote command queue for admin → desktop actions.
// Primary delivery is WebSocket; HTTP poll is a short-lived fallback
// so trackers that reconnect within the TTL still receive the request.

import { randomUUID } from 'crypto';

export type RemoteCommandType = 'screenshot';

export interface PendingRemoteCommand {
  id: string;
  type: RemoteCommandType;
  orgId: string;
  employeeId: string;
  requestedBy: string;
  createdAt: number;
  expiresAt: number;
  deliveredViaWs: boolean;
}

const COMMAND_TTL_MS = 90_000;
const pending = new Map<string, PendingRemoteCommand>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, cmd] of pending) {
    if (cmd.expiresAt <= now) pending.delete(id);
  }
}

export function enqueueRemoteCommand(input: {
  type: RemoteCommandType;
  orgId: string;
  employeeId: string;
  requestedBy: string;
}): PendingRemoteCommand {
  pruneExpired();
  const now = Date.now();
  const cmd: PendingRemoteCommand = {
    id: randomUUID(),
    type: input.type,
    orgId: input.orgId,
    employeeId: input.employeeId,
    requestedBy: input.requestedBy,
    createdAt: now,
    expiresAt: now + COMMAND_TTL_MS,
    deliveredViaWs: false,
  };
  pending.set(cmd.id, cmd);
  return cmd;
}

export function markCommandDelivered(id: string): void {
  const cmd = pending.get(id);
  if (cmd) cmd.deliveredViaWs = true;
}

export function listCommandsForEmployee(
  orgId: string,
  employeeId: string
): PendingRemoteCommand[] {
  pruneExpired();
  const out: PendingRemoteCommand[] = [];
  for (const cmd of pending.values()) {
    if (cmd.orgId === orgId && cmd.employeeId === employeeId) {
      out.push(cmd);
    }
  }
  return out;
}

/** @deprecated Prefer listCommandsForEmployee — keep until call sites migrate. */
export function consumeCommandsForEmployee(
  orgId: string,
  employeeId: string
): PendingRemoteCommand[] {
  return listCommandsForEmployee(orgId, employeeId);
}

export function peekCommand(id: string): PendingRemoteCommand | undefined {
  pruneExpired();
  return pending.get(id);
}

export function consumeCommand(id: string, orgId: string, employeeId: string): PendingRemoteCommand | undefined {
  pruneExpired();
  const cmd = pending.get(id);
  if (!cmd) return undefined;
  if (cmd.orgId !== orgId || cmd.employeeId !== employeeId) return undefined;
  pending.delete(id);
  return cmd;
}
