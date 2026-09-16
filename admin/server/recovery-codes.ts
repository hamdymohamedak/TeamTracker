/**
 * Offline password recovery via one-time recovery codes.
 * No email / SMS / third-party services required.
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from './database.js';
import { hashToken } from './auth.js';

const DEFAULT_CODE_COUNT = 10;

/** Normalize user input: strip separators/spaces, uppercase. */
export function normalizeRecoveryCode(code: string): string {
  return String(code || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

/** Human-readable plain code, e.g. A1B2C-D3E4F */
export function generateRecoveryCodePlain(): string {
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/**
 * Replace unused codes for a user and return the new plaintext codes once.
 * Used codes are left for audit; unused ones are deleted first.
 */
export async function issueRecoveryCodes(
  userId: string,
  count: number = DEFAULT_CODE_COUNT
): Promise<string[]> {
  const db = getDatabase();
  const now = new Date().toISOString();

  await db.run(
    `DELETE FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`,
    [userId]
  );

  const plains: string[] = [];
  for (let i = 0; i < count; i++) {
    const plain = generateRecoveryCodePlain();
    plains.push(plain);
    await db.run(
      `INSERT INTO recovery_codes (id, user_id, code_hash, used_at, created_at)
       VALUES (?, ?, ?, NULL, ?)`,
      [uuidv4(), userId, hashToken(normalizeRecoveryCode(plain)), now]
    );
  }
  return plains;
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.get(
    `SELECT COUNT(*) as c FROM recovery_codes WHERE user_id = ? AND used_at IS NULL`,
    [userId]
  );
  return Number(row?.c || 0);
}

/**
 * Consume one unused recovery code for the user. Returns true if matched.
 */
export async function consumeRecoveryCode(
  userId: string,
  code: string
): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length < 8) return false;

  const db = getDatabase();
  const now = new Date().toISOString();
  const row = await db.get(
    `SELECT id FROM recovery_codes
     WHERE user_id = ? AND code_hash = ? AND used_at IS NULL`,
    [userId, hashToken(normalized)]
  );
  if (!row) return false;

  await db.run(`UPDATE recovery_codes SET used_at = ? WHERE id = ?`, [now, row.id]);
  return true;
}

/** Wipe all dashboard sessions for a user after a password change. */
export async function invalidateUserSessions(userId: string): Promise<void> {
  const db = getDatabase();
  await db.run(`DELETE FROM refresh_tokens WHERE user_id = ?`, [userId]);
}
