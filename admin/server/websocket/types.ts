import { WebSocket } from 'ws';
import type { LiveViewQualityMode } from '../../shared/live-view/index.js';

export interface ConnectedClient {
  ws: WebSocket;
  employeeId?: string;
  employeeName?: string;
  isAdmin?: boolean;
  orgId?: string;
  tokenType?: 'dashboard' | 'device';
}

/** One live screen session: admin watches one employee; frames relay only to that admin. */
export interface LiveViewSession {
  sessionId: string;
  orgId: string;
  employeeId: string;
  adminWs: WebSocket;
  quality: LiveViewQualityMode;
}
