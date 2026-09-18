import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runMigrations } from '../migrations.js';
import {
  getPaths,
  ensureDataDirectories,
  listLegacyDatabaseCandidates,
  replaceDatabaseWithLegacy,
} from '../paths.js';
import { logger } from '../logger.js';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: Database<sqlite3.Database, sqlite3.Statement> | null = null;

async function openWithPragmas(databasePath: string): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
  const opened = await open({
    filename: databasePath,
    driver: sqlite3.Database,
  });
  await opened.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
  `);
  return opened;
}

async function countUsersSafe(
  handle: Database<sqlite3.Database, sqlite3.Statement>
): Promise<number | null> {
  try {
    const table = await handle.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='users'`
    );
    if (!table) return 0;
    const row = await handle.get<{ c: number }>('SELECT COUNT(*) AS c FROM users');
    return row?.c ?? 0;
  } catch {
    return null;
  }
}

/** If current DB has no users, adopt a legacy SQLite that does (never overwrite populated DBs). */
async function recoverUsersFromLegacyIfNeeded(databasePath: string): Promise<boolean> {
  // Only heal production path-switch incidents — never in test/dev
  if (process.env.NODE_ENV !== 'production') return false;
  const current = db;
  if (!current) return false;
  const currentUsers = await countUsersSafe(current);
  if (currentUsers === null || currentUsers > 0) return false;

  for (const legacy of listLegacyDatabaseCandidates(databasePath)) {
    if (!fs.existsSync(legacy)) continue;
    let legacyDb: Database<sqlite3.Database, sqlite3.Statement> | null = null;
    try {
      legacyDb = await open({ filename: legacy, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
      const legacyUsers = await countUsersSafe(legacyDb);
      await legacyDb.close();
      legacyDb = null;
      if (!legacyUsers || legacyUsers <= 0) continue;

      await current.close();
      db = null;
      const ok = replaceDatabaseWithLegacy(databasePath, legacy);
      if (!ok) {
        db = await openWithPragmas(databasePath);
        return false;
      }
      logger.warn('Recovered production database from legacy path', {
        from: legacy,
        to: databasePath,
        users: legacyUsers,
      });
      db = await openWithPragmas(databasePath);
      return true;
    } catch (err) {
      if (legacyDb) {
        try {
          await legacyDb.close();
        } catch {
          /* ignore */
        }
      }
      logger.warn('Skipped legacy DB candidate', { path: legacy, err });
    }
  }
  return false;
}

export async function initDatabase(): Promise<Database<sqlite3.Database, sqlite3.Statement>> {
  if (db) return db;

  ensureDataDirectories();
  const { databasePath } = getPaths();
  const dbDir = path.dirname(databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true, mode: 0o750 });
  }

  logger.info('Opening SQLite database', { path: databasePath });

  db = await openWithPragmas(databasePath);

  await createTables();
  await runMigrations(db);

  // Heal path-switch incidents: new empty DB + old admin/data/admin.db with accounts
  const recovered = await recoverUsersFromLegacyIfNeeded(databasePath);
  if (recovered && db) {
    await createTables();
    await runMigrations(db);
  }

  // Never seed demo data in production — only when explicitly requested in development
  if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO_DATA === '1') {
    await seedTestData();
  }

  return db;
}

export function getDatabase(): Database<sqlite3.Database, sqlite3.Statement> {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

async function createTables(): Promise<void> {
  if (!db) return;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'employee',
      department TEXT,
      hourly_rate REAL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      client_name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT NOT NULL,
      end_date TEXT,
      budget REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      estimated_hours REAL,
      assigned_to TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (assigned_to) REFERENCES employees(id)
    );

    -- NEW: Activities table for smart tracking
    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      app_name TEXT NOT NULL,
      window_title TEXT NOT NULL,
      category TEXT NOT NULL,
      category_name TEXT NOT NULL,
      productivity_score INTEGER NOT NULL,
      productivity_level TEXT NOT NULL,
      is_suspicious INTEGER DEFAULT 0,
      suspicious_reason TEXT,
      is_idle INTEGER DEFAULT 0,
      idle_time_seconds INTEGER DEFAULT 0,
      duration_seconds INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    -- Legacy time_entries table (kept for compatibility)
    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      task_id TEXT,
      project_id TEXT,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT,
      duration INTEGER DEFAULT 0,
      is_billable INTEGER DEFAULT 1,
      idle_time INTEGER DEFAULT 0,
      source TEXT DEFAULT 'desktop',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    -- Smart Role Detection: stores detected/overridden role per employee
    CREATE TABLE IF NOT EXISTS role_profiles (
      employee_id TEXT PRIMARY KEY,
      role_type TEXT NOT NULL DEFAULT 'unknown',
      display_name TEXT NOT NULL DEFAULT 'Not yet detected',
      confidence INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'learning',
      detected_at TEXT,
      learning_started_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    -- Classification overrides: admin can override app categorization per employee or role
    CREATE TABLE IF NOT EXISTS classification_overrides (
      id TEXT PRIMARY KEY,
      employee_id TEXT,
      role_type TEXT,
      app_pattern TEXT NOT NULL,
      category TEXT NOT NULL,
      productivity_score INTEGER NOT NULL,
      created_by TEXT DEFAULT 'admin',
      created_at TEXT NOT NULL
    );

    -- Privacy blocks: skip screenshots / live view when app/title/URL matches
    CREATE TABLE IF NOT EXISTS capture_privacy_blocks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      employee_id TEXT,
      app_pattern TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      block_screenshots INTEGER NOT NULL DEFAULT 1,
      block_live_view INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activities_employee ON activities(employee_id);
    CREATE INDEX IF NOT EXISTS idx_activities_timestamp ON activities(timestamp);
    CREATE INDEX IF NOT EXISTS idx_activities_category ON activities(category);
    CREATE INDEX IF NOT EXISTS idx_time_entries_employee ON time_entries(employee_id);
    CREATE INDEX IF NOT EXISTS idx_time_entries_start ON time_entries(start_time);
    CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
    CREATE INDEX IF NOT EXISTS idx_overrides_employee ON classification_overrides(employee_id);
    CREATE INDEX IF NOT EXISTS idx_overrides_role ON classification_overrides(role_type);
    CREATE INDEX IF NOT EXISTS idx_privacy_blocks_org ON capture_privacy_blocks(org_id);
    CREATE INDEX IF NOT EXISTS idx_privacy_blocks_employee ON capture_privacy_blocks(employee_id);
  `);
}

async function seedTestData(): Promise<void> {
  if (!db) return;

  // Check if already seeded
  const count = await db.get('SELECT COUNT(*) as count FROM employees');
  if (count.count > 0) return;

  const now = new Date().toISOString();

  // Seed employees
  const employees = [
    { id: 'emp-001', name: 'Mohammed', email: 'mohammed@archfirm.com', role: 'employee', department: 'Architecture', hourly_rate: 75 },
    { id: 'emp-002', name: 'Ahmed', email: 'ahmed@archfirm.com', role: 'employee', department: 'Architecture', hourly_rate: 65 },
    { id: 'emp-003', name: 'Sarah', email: 'sarah@archfirm.com', role: 'manager', department: 'Design', hourly_rate: 85 },
  ];

  for (const emp of employees) {
    await db.run(
      `INSERT INTO employees (id, name, email, role, department, hourly_rate, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp.id, emp.name, emp.email, emp.role, emp.department, emp.hourly_rate, now, now]
    );
  }

  // Seed projects
  const projects = [
    { id: 'proj-001', name: 'Downtown Office Complex', description: 'Modern office building with sustainable design', client_name: 'ABC Corp', budget: 500000 },
    { id: 'proj-002', name: 'Residential Tower', description: 'High-rise residential building', client_name: 'XYZ Developers', budget: 750000 },
    { id: 'proj-003', name: 'Community Center', description: 'Multi-purpose community facility', client_name: 'City Council', budget: 300000 },
  ];

  for (const proj of projects) {
    await db.run(
      `INSERT INTO projects (id, name, description, client_name, status, start_date, budget, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [proj.id, proj.name, proj.description, proj.client_name, now, proj.budget, now, now]
    );
  }

  // Seed tasks
  const tasks = [
    { id: 'task-001', project_id: 'proj-001', name: 'Initial Design Concepts', description: 'Create initial design concepts', priority: 'high', estimated_hours: 40, assigned_to: 'emp-001' },
    { id: 'task-002', project_id: 'proj-001', name: 'Site Analysis', description: 'Analyze site conditions', priority: 'high', estimated_hours: 16, assigned_to: 'emp-002' },
    { id: 'task-003', project_id: 'proj-002', name: 'Floor Plan Development', description: 'Develop detailed floor plans', priority: 'medium', estimated_hours: 60, assigned_to: 'emp-001' },
    { id: 'task-004', project_id: 'proj-003', name: 'Client Meeting Prep', description: 'Prepare presentation materials', priority: 'low', estimated_hours: 8, assigned_to: 'emp-003' },
  ];

  for (const task of tasks) {
    await db.run(
      `INSERT INTO tasks (id, project_id, name, description, status, priority, estimated_hours, assigned_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?)`,
      [task.id, task.project_id, task.name, task.description, task.priority, task.estimated_hours, task.assigned_to, now, now]
    );
  }

  console.log('✅ Test data seeded');
}
