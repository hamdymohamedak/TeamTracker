// Authentication module for TeamTracker
import './types.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { getDatabase } from './database.js';

const BCRYPT_ROUNDS = 12;

let _jwtSecret: string | null = null;

function getJwtSecret(): string {
  if (_jwtSecret) return _jwtSecret;
  if (process.env.JWT_SECRET) {
    _jwtSecret = process.env.JWT_SECRET;
    return _jwtSecret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  // Stable dev secret so tokens survive restarts
  _jwtSecret =
    'teamtracker-dev-secret-change-in-production-' +
    crypto.createHash('sha256').update('teamtracker').digest('hex');
  console.warn('WARNING: Using auto-generated JWT_SECRET. Set JWT_SECRET in .env for production.');
  return _jwtSecret;
}

const DASHBOARD_TOKEN_EXPIRY = '24h';
/** Long-lived device JWT — access ends when the session is revoked or the employee is deactivated. */
const DEVICE_TOKEN_EXPIRY = '3650d';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface DashboardTokenPayload {
  userId: string;
  orgId: string;
  email: string;
  type: 'dashboard';
}

export interface DeviceTokenPayload {
  employeeId: string;
  orgId: string;
  type: 'device';
  /** device_sessions.id — present on tokens issued after migration 7 */
  sid?: string;
}

type TokenPayload = DashboardTokenPayload | DeviceTokenPayload;

export function generateDashboardToken(payload: Omit<DashboardTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'dashboard' }, getJwtSecret(), { expiresIn: DASHBOARD_TOKEN_EXPIRY });
}

export function generateDeviceToken(
  payload: Omit<DeviceTokenPayload, 'type'> & { sid?: string }
): string {
  return jwt.sign({ ...payload, type: 'device' }, getJwtSecret(), { expiresIn: DEVICE_TOKEN_EXPIRY });
}

/**
 * Create a durable device session and return a JWT bound to it.
 * Employee connects once; stays signed in until revoke / employee delete.
 */
export async function issueDeviceSession(
  orgId: string,
  employeeId: string
): Promise<{ accessToken: string; sessionId: string }> {
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDatabase().run(
    `INSERT INTO device_sessions (id, org_id, employee_id, created_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    [sessionId, orgId, employeeId, now, now]
  );
  const accessToken = generateDeviceToken({ employeeId, orgId, sid: sessionId });
  return { accessToken, sessionId };
}

export async function revokeEmployeeDeviceSessions(
  orgId: string,
  employeeId: string
): Promise<number> {
  const now = new Date().toISOString();
  const result = await getDatabase().run(
    `UPDATE device_sessions SET revoked_at = ?
     WHERE org_id = ? AND employee_id = ? AND revoked_at IS NULL`,
    [now, orgId, employeeId]
  );
  return result.changes ?? 0;
}

export type DeviceAccessResult =
  | { ok: true }
  | { ok: false; code: 'EMPLOYEE_INACTIVE' | 'DEVICE_REVOKED'; error: string };

/**
 * Server-side gate for device JWTs: employee must be active, and if the token
 * carries a session id it must not be revoked. Legacy tokens without `sid`
 * are allowed until they naturally expire (then re-enroll issues a session).
 */
export async function assertDeviceAccess(
  payload: DeviceTokenPayload
): Promise<DeviceAccessResult> {
  const db = getDatabase();
  const emp = await db.get(
    'SELECT id, is_active FROM employees WHERE id = ? AND org_id = ?',
    [payload.employeeId, payload.orgId]
  );
  if (!emp || emp.is_active !== 1) {
    return {
      ok: false,
      code: 'EMPLOYEE_INACTIVE',
      error: 'Employee is inactive or removed',
    };
  }

  if (payload.sid) {
    const session = await db.get(
      `SELECT id, revoked_at FROM device_sessions
       WHERE id = ? AND employee_id = ? AND org_id = ?`,
      [payload.sid, payload.employeeId, payload.orgId]
    );
    if (!session || session.revoked_at) {
      return {
        ok: false,
        code: 'DEVICE_REVOKED',
        error: 'Device access has been revoked',
      };
    }
  }

  return { ok: true };
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, getJwtSecret()) as TokenPayload;
}

export function generateSetupToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

function extractBearer(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

/** Dashboard users only — never accept device JWTs. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  try {
    const payload = verifyToken(token);
    if (payload.type !== 'dashboard') {
      res.status(403).json({ success: false, error: 'Dashboard authentication required' });
      return;
    }
    req.orgId = payload.orgId;
    req.userId = payload.userId;
    req.tokenType = 'dashboard';
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/** Device (desktop tracker) JWTs only — also checks session + employee active. */
export async function requireDeviceAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'Device authentication required' });
    return;
  }

  try {
    const payload = verifyToken(token);
    if (payload.type !== 'device') {
      res.status(403).json({ success: false, error: 'Device authentication required' });
      return;
    }

    const access = await assertDeviceAccess(payload);
    if (!access.ok) {
      res.status(401).json({ success: false, error: access.error, code: access.code });
      return;
    }

    req.orgId = payload.orgId;
    req.employeeId = payload.employeeId;
    req.tokenType = 'device';
    req.deviceSessionId = payload.sid;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired device token' });
  }
}

/** Accept either dashboard or device auth. */
export async function requireAnyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.orgId = payload.orgId;
    req.tokenType = payload.type;
    if (payload.type === 'dashboard') {
      req.userId = payload.userId;
      next();
      return;
    }
    if (payload.type === 'device') {
      const access = await assertDeviceAccess(payload);
      if (!access.ok) {
        res.status(401).json({ success: false, error: access.error, code: access.code });
        return;
      }
      req.employeeId = payload.employeeId;
      req.deviceSessionId = payload.sid;
      next();
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid token type' });
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/**
 * Require the dashboard user to have one of the given roles in their org.
 * Must be used after requireAuth.
 */
export function requireRole(...roles: Array<'owner' | 'admin' | 'viewer'>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.userId || !req.orgId) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }
      const db = getDatabase();
      const user = await db.get(
        'SELECT role FROM users WHERE id = ? AND org_id = ?',
        [req.userId, req.orgId]
      );
      if (!user || !roles.includes(user.role)) {
        res.status(403).json({ success: false, error: 'Insufficient permissions' });
        return;
      }
      req.userRole = user.role;
      next();
    } catch (e) {
      res.status(500).json({ success: false, error: 'Authorization check failed' });
    }
  };
}
