/**
 * Create an organization + owner account (used by public signup bootstrap and vendor provision).
 */
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database.js';
import { hashPassword, generateDashboardToken, generateRefreshToken, hashToken } from '../auth.js';
import { issueRecoveryCodes } from '../recovery-codes.js';

export type ProvisionOrgInput = {
  email: string;
  password: string;
  name: string;
  orgName: string;
  timezone?: string;
};

export type ProvisionOrgResult = {
  accessToken: string;
  refreshToken: string;
  recoveryCodes: string[];
  password: string;
  user: { id: string; email: string; name: string; role: 'owner' };
  org: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    logoUrl: null;
    defaultCurrency: string;
  };
};

export class ProvisionOrgError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function resolveTimezone(timezone?: string): string {
  if (typeof timezone === 'string' && timezone.trim()) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      return timezone;
    } catch {
      /* keep UTC */
    }
  }
  return 'UTC';
}

export async function provisionOrganization(input: ProvisionOrgInput): Promise<ProvisionOrgResult> {
  const email = String(input.email || '').trim().toLowerCase();
  const password = String(input.password || '');
  const name = String(input.name || '').trim();
  const orgName = String(input.orgName || '').trim();

  if (!email || !password || !name || !orgName) {
    throw new ProvisionOrgError(400, 'email, password, name, and orgName are required');
  }
  if (password.length < 6) {
    throw new ProvisionOrgError(400, 'Password must be at least 6 characters');
  }

  const db = getDatabase();
  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    throw new ProvisionOrgError(409, 'Email already registered');
  }

  const now = new Date().toISOString();
  const orgId = uuidv4();
  const userId = uuidv4();
  const slugBase =
    orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || uuidv4().slice(0, 8);
  const existingSlug = await db.get('SELECT id FROM organizations WHERE slug = ?', [slugBase]);
  const finalSlug = existingSlug ? `${slugBase}-${uuidv4().slice(0, 4)}` : slugBase;
  const orgTz = resolveTimezone(input.timezone);

  await db.run(
    `INSERT INTO organizations (id, name, slug, owner_email, timezone, default_currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [orgId, orgName, finalSlug, email, orgTz, 'USD', now, now]
  );

  const passwordHash = await hashPassword(password);
  await db.run(
    `INSERT INTO users (id, org_id, email, password_hash, name, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'owner', ?, ?)`,
    [userId, orgId, email, passwordHash, name, now, now]
  );

  const accessToken = generateDashboardToken({ userId, orgId, email });
  const refreshToken = generateRefreshToken();
  const refreshExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db.run(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [uuidv4(), userId, hashToken(refreshToken), refreshExpiry, now]
  );

  const recoveryCodes = await issueRecoveryCodes(userId);

  return {
    accessToken,
    refreshToken,
    recoveryCodes,
    password,
    user: { id: userId, email, name, role: 'owner' },
    org: {
      id: orgId,
      name: orgName,
      slug: finalSlug,
      timezone: orgTz,
      logoUrl: null,
      defaultCurrency: 'USD',
    },
  };
}
