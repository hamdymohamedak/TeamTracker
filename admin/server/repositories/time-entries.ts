import type { TimeEntry } from '../../shared-types.js';
import { getDatabase } from '../database/connection.js';

// Legacy Time Entry operations (kept for compatibility)
export async function getAllTimeEntries(orgId: string, startDate?: string, endDate?: string): Promise<TimeEntry[]> {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: any[] = [];

  conditions.push('org_id = ?'); params.push(orgId);
  if (startDate) { conditions.push('start_time >= ?'); params.push(startDate); }
  if (endDate) { conditions.push('start_time <= ?'); params.push(endDate); }

  let query = 'SELECT * FROM time_entries';
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY start_time DESC';

  const rows = await db.all(query, params);
  return rows.map(mapTimeEntry);
}

export async function getTimeEntriesByEmployee(orgId: string, employeeId: string, startDate?: string, endDate?: string): Promise<TimeEntry[]> {
  const db = getDatabase();
  let query = 'SELECT * FROM time_entries WHERE employee_id = ? AND org_id = ?';
  const params: any[] = [employeeId, orgId];

  if (startDate) {
    query += ' AND start_time >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND start_time <= ?';
    params.push(endDate);
  }

  query += ' ORDER BY start_time DESC';

  const rows = await db.all(query, params);
  return rows.map(mapTimeEntry);
}

export async function createTimeEntry(orgId: string, entry: TimeEntry): Promise<void> {
  const db = getDatabase();
  await db.run(
    `INSERT INTO time_entries (id, org_id, employee_id, task_id, project_id, description, start_time, end_time, duration, is_billable, idle_time, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.id, orgId, entry.employeeId, entry.taskId, entry.projectId, entry.description, entry.startTime, entry.endTime, entry.duration, entry.isBillable ? 1 : 0, entry.idleTime, entry.createdAt, entry.updatedAt]
  );
}

export async function updateTimeEntry(orgId: string, id: string, updates: Partial<TimeEntry>): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const sets: string[] = [];
  const values: any[] = [];

  if (updates.endTime) { sets.push('end_time = ?'); values.push(updates.endTime); }
  if (updates.duration !== undefined) { sets.push('duration = ?'); values.push(updates.duration); }
  if (updates.idleTime !== undefined) { sets.push('idle_time = ?'); values.push(updates.idleTime); }

  sets.push('updated_at = ?'); values.push(now);
  values.push(id);
  values.push(orgId);

  await db.run(`UPDATE time_entries SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`, values);
}

export async function getActiveTimeEntries(orgId: string): Promise<TimeEntry[]> {
  const db = getDatabase();
  const rows = await db.all('SELECT * FROM time_entries WHERE end_time IS NULL AND org_id = ?', [orgId]);
  return rows.map(mapTimeEntry);
}

export async function getTimeEntryById(orgId: string, id: string): Promise<TimeEntry | null> {
  const db = getDatabase();
  const row = await db.get('SELECT * FROM time_entries WHERE id = ? AND org_id = ?', [id, orgId]);
  return row ? mapTimeEntry(row) : null;
}

function mapTimeEntry(row: any): TimeEntry {
  return {
    id: row.id,
    employeeId: row.employee_id,
    taskId: row.task_id,
    projectId: row.project_id,
    description: row.description,
    startTime: row.start_time,
    endTime: row.end_time,
    duration: row.duration,
    isBillable: row.is_billable === 1,
    idleTime: row.idle_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
