/**
 * Vendor provisioning API — create customer orgs without opening public signup.
 * Auth: header `X-Vendor-Secret` or body.vendorSecret must match VENDOR_SECRET.
 */
import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { rateLimit } from '../rate-limit.js';
import { logger } from '../logger.js';
import { ProvisionOrgError, provisionOrganization } from '../services/provision-org.js';

const vendorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  keyPrefix: 'vendor',
  message: 'Too many vendor requests. Please try again later.',
});

function configuredVendorSecret(): string {
  return (process.env.VENDOR_SECRET || '').trim();
}

function secretsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireVendorSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = configuredVendorSecret();
  if (!expected || expected.length < 16) {
    res.status(503).json({
      success: false,
      error: 'VENDOR_SECRET is not configured on this server (min 16 chars).',
      code: 'VENDOR_NOT_CONFIGURED',
    });
    return;
  }

  const provided = String(
    req.header('x-vendor-secret') ||
      req.header('X-Vendor-Secret') ||
      (req.body && req.body.vendorSecret) ||
      ''
  ).trim();

  if (!provided || !secretsEqual(provided, expected)) {
    res.status(401).json({ success: false, error: 'Invalid vendor secret', code: 'VENDOR_UNAUTHORIZED' });
    return;
  }

  next();
}

function randomPassword(length = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function setupVendorRoutes(app: Express): void {
  app.get('/api/vendor/status', (_req, res) => {
    const secret = configuredVendorSecret();
    res.json({
      success: true,
      data: {
        configured: secret.length >= 16,
      },
    });
  });

  app.post('/api/vendor/provision-org', vendorLimiter, requireVendorSecret, async (req, res) => {
    try {
      const { email, password, name, orgName, timezone } = req.body || {};
      const finalPassword =
        typeof password === 'string' && password.trim().length >= 6
          ? password.trim()
          : randomPassword(14);

      const result = await provisionOrganization({
        email,
        password: finalPassword,
        name,
        orgName,
        timezone,
      });

      logger.info('Vendor provisioned organization', {
        orgId: result.org.id,
        email: result.user.email,
      });

      // Do not return dashboard JWT to the vendor UI by default — only credentials to share.
      res.json({
        success: true,
        data: {
          org: result.org,
          user: result.user,
          password: result.password,
          recoveryCodes: result.recoveryCodes,
          loginUrl: '/login',
        },
      });
    } catch (error) {
      if (error instanceof ProvisionOrgError) {
        return res.status(error.status).json({ success: false, error: error.message });
      }
      logger.error('Vendor provision failed', { error: String(error) });
      res.status(500).json({ success: false, error: String(error) });
    }
  });
}
