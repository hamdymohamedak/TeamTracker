#!/usr/bin/env node
/**
 * Break-glass password reset for VPS / local ops.
 * Does NOT use email — runs against the SQLite database on this machine.
 *
 * Usage:
 *   cd admin
 *   node scripts/reset-password.mjs --email owner@company.com --password 'NewSecret1'
 *
 * Optional:
 *   DATABASE_PATH=/var/lib/teamtracker/database/admin.db node scripts/reset-password.mjs ...
 *   --codes   also issue fresh recovery codes and print them once
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { email: '', password: '', codes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') out.email = argv[++i] || '';
    else if (a === '--password') out.password = argv[++i] || '';
    else if (a === '--codes') out.codes = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function resolveDbPath() {
  if (process.env.DATABASE_PATH) return path.resolve(process.env.DATABASE_PATH);
  const prod = '/var/lib/teamtracker/database/admin.db';
  if (fs.existsSync(prod)) return prod;
  return path.join(__dirname, '../data/admin.db');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeCode(code) {
  return String(code).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function makeCode() {
  const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.email || !args.password) {
    console.log(`Usage:
  node scripts/reset-password.mjs --email user@example.com --password 'NewSecret1' [--codes]

Env:
  DATABASE_PATH  Full path to admin.db (optional)
`);
    process.exit(args.help ? 0 : 1);
  }

  if (args.password.length < 6) {
    console.error('Password must be at least 6 characters');
    process.exit(1);
  }

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }

  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  const user = await db.get('SELECT id, email, name FROM users WHERE email = ?', [args.email]);
  if (!user) {
    console.error(`No user with email: ${args.email}`);
    await db.close();
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(args.password, 12);
  const now = new Date().toISOString();
  await db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
    passwordHash,
    now,
    user.id,
  ]);
  await db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [user.id]);

  console.log(`✓ Password reset for ${user.email} (${user.name})`);
  console.log('  All dashboard sessions for this user were cleared.');

  // Ensure recovery_codes table exists (migration 8)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS recovery_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
  `);

  if (args.codes) {
    await db.run('DELETE FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', [user.id]);
    const plains = [];
    for (let i = 0; i < 10; i++) {
      const plain = makeCode();
      plains.push(plain);
      await db.run(
        `INSERT INTO recovery_codes (id, user_id, code_hash, used_at, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
        [crypto.randomUUID(), user.id, hashToken(normalizeCode(plain)), now]
      );
    }
    console.log('\nNew recovery codes (save offline — shown once):\n');
    for (const c of plains) console.log(`  ${c}`);
    console.log('');
  }

  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
