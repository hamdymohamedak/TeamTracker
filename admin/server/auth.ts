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
const DEVICE_TOKEN_EXPIRY = '90d';

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
}

type TokenPayload = DashboardTokenPayload | DeviceTokenPayload;

export function generateDashboardToken(payload: Omit<DashboardTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'dashboard' }, getJwtSecret(), { expiresIn: DASHBOARD_TOKEN_EXPIRY });
}

export function generateDeviceToken(payload: Omit<DeviceTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'device' }, getJwtSecret(), { expiresIn: DEVICE_TOKEN_EXPIRY });
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

/** Device (desktop tracker) JWTs only. */
export function requireDeviceAuth(req: Request, res: Response, next: NextFunction): void {
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
    req.orgId = payload.orgId;
    req.employeeId = payload.employeeId;
    req.tokenType = 'device';
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired device token' });
  }
}

/** Accept either dashboard or device auth. */
export function requireAnyAuth(req: Request, res: Response, next: NextFunction): void {
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
    } else if (payload.type === 'device') {
      req.employeeId = payload.employeeId;
    } else {
      res.status(401).json({ success: false, error: 'Invalid token type' });
      return;
    }
    next();
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
