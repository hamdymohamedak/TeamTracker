import { WebSocket } from 'ws';
import type { ConnectedClient, LiveViewSession } from './types.js';

export const clients = new Map<WebSocket, ConnectedClient>();

/** admin socket → session */
export const liveByAdmin = new Map<WebSocket, LiveViewSession>();

/** employeeId → session (at most one viewer per employee) */
export const liveByEmployee = new Map<string, LiveViewSession>();

export function broadcastToAdmins(orgId: string, message: unknown): void {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.isAdmin && client.orgId === orgId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  });
}

export function broadcastToEmployees(orgId: string, message: unknown): void {
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

export function findClientByEmployeeId(orgId: string, employeeId: string): ConnectedClient | undefined {
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
