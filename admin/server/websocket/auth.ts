import { URL } from 'url';
import { verifyToken, assertDeviceAccess, type DeviceTokenPayload } from '../auth.js';

export type ConnectionAuthResult =
  | { ok: true; orgId: string; employeeId: string | undefined; isAdmin: boolean; tokenType: 'dashboard' | 'device' }
  | { ok: false; code: number; message: string };

/**
 * Authenticate a WebSocket connection from its upgrade request.
 * Reads the `token` query param, verifies it, and (for device tokens)
 * checks the device-session is still active.
 */
export async function authenticateConnection(req: {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}): Promise<ConnectionAuthResult> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');
    if (!token) {
      return { ok: false, code: 4001, message: 'Authentication required: no token provided' };
    }

    const payload = verifyToken(token);
    const orgId = payload.orgId;

    if (payload.type === 'device') {
      const access = await assertDeviceAccess(payload as DeviceTokenPayload);
      if (!access.ok) {
        return { ok: false, code: 4003, message: access.error };
      }
      return { ok: true, orgId, employeeId: payload.employeeId, isAdmin: false, tokenType: 'device' };
    }

    if (payload.type === 'dashboard') {
      return { ok: true, orgId, employeeId: payload.userId, isAdmin: true, tokenType: 'dashboard' };
    }

    return { ok: false, code: 4002, message: 'Authentication failed: unsupported token type' };
  } catch (err) {
    console.warn('WebSocket auth failed:', (err as Error).message);
    return { ok: false, code: 4002, message: 'Authentication failed: invalid or expired token' };
  }
}
