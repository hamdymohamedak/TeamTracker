import type { Activity } from '../../shared-types.js';
import { getDatabase } from '../database/connection.js';

// Activity operations
export async function createActivity(orgId: string, activity: Activity): Promise<void> {
  const db = getDatabase();
  await db.run(
    `INSERT INTO activities (
      id, org_id, employee_id, timestamp, app_name, window_title,
      category, category_name, productivity_score, productivity_level,
      is_suspicious, suspicious_reason, is_idle, idle_time_seconds, duration_seconds,
      project_id, task_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      activity.id,
      orgId,
      activity.employeeId,
      activity.timestamp,
      activity.appName,
      activity.windowTitle,
      activity.category,
      activity.categoryName,
      activity.productivityScore,
      activity.productivityLevel,
      activity.isSuspicious ? 1 : 0,
      activity.suspiciousReason,
      activity.isIdle ? 1 : 0,
      activity.idleTimeSeconds,
      activity.durationSeconds,
      activity.projectId || null,
      activity.taskId || null,
      activity.createdAt
    ]
  );
}

export async function getActivityById(orgId: string, id: string): Promise<Activity | null> {
  const db = getDatabase();
  const row = await db.get('SELECT * FROM activities WHERE id = ? AND org_id = ?', [id, orgId]);
  return row ? mapActivity(row) : null;
}

export async function updateActivity(orgId: string, id: string, updates: Partial<Activity>): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const sets: string[] = [];
  const values: any[] = [];

  if (updates.appName) { sets.push('app_name = ?'); values.push(updates.appName); }
  if (updates.windowTitle) { sets.push('window_title = ?'); values.push(updates.windowTitle); }
  if (updates.category) { sets.push('category = ?'); values.push(updates.category); }
  if (updates.categoryName) { sets.push('category_name = ?'); values.push(updates.categoryName); }
  if (updates.productivityScore !== undefined) { sets.push('productivity_score = ?'); values.push(updates.productivityScore); }
  if (updates.productivityLevel) { sets.push('productivity_level = ?'); values.push(updates.productivityLevel); }
  if (updates.isSuspicious !== undefined) { sets.push('is_suspicious = ?'); values.push(updates.isSuspicious ? 1 : 0); }
  if (updates.suspiciousReason) { sets.push('suspicious_reason = ?'); values.push(updates.suspiciousReason); }
  if (updates.isIdle !== undefined) { sets.push('is_idle = ?'); values.push(updates.isIdle ? 1 : 0); }
  if (updates.idleTimeSeconds !== undefined) { sets.push('idle_time_seconds = ?'); values.push(updates.idleTimeSeconds); }
  if (updates.durationSeconds !== undefined) { sets.push('duration_seconds = ?'); values.push(updates.durationSeconds); }

  sets.push('updated_at = ?'); values.push(now);
  values.push(id);
  values.push(orgId);

  await db.run(`UPDATE activities SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`, values);
}

export async function getActivitiesByEmployee(
  orgId: string,
  employeeId: string,
  startDate?: string,
  endDate?: string
): Promise<Activity[]> {
  const db = getDatabase();
  let query = 'SELECT * FROM activities WHERE employee_id = ? AND org_id = ?';
  const params: any[] = [employeeId, orgId];

  if (startDate) {
    query += ' AND timestamp >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND timestamp <= ?';
    params.push(endDate);
  }

  query += ' ORDER BY timestamp DESC';

  const rows = await db.all(query, params);
  return rows.map(mapActivity);
}

export async function getAllActivities(orgId: string, startDate?: string, endDate?: string): Promise<Activity[]> {
  const db = getDatabase();
  let query = 'SELECT * FROM activities';
  const params: any[] = [];
  const conditions: string[] = [];

  conditions.push('org_id = ?'); params.push(orgId);
  if (startDate) { conditions.push('timestamp >= ?'); params.push(startDate); }
  if (endDate) { conditions.push('timestamp <= ?'); params.push(endDate); }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY timestamp DESC';

  const rows = await db.all(query, params);
  return rows.map(mapActivity);
}

export async function getSuspiciousActivities(orgId: string, employeeId?: string, limit: number = 50): Promise<Activity[]> {
  const db = getDatabase();
  const systemApps = ['loginwindow', 'lockscreen', 'screensaver', 'window server', 'idle'];
  const appExclusions = systemApps.map(app => `LOWER(app_name) != '${app}'`).join(' AND ');

  let query = `SELECT * FROM activities WHERE is_suspicious = 1 AND ${appExclusions} AND org_id = ?`;
  const params: any[] = [orgId];

  if (employeeId) { query += ' AND employee_id = ?'; params.push(employeeId); }

  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = await db.all(query, params);
  return rows.map(mapActivity);
}

export async function getActivityStats(orgId: string, employeeId?: string, startDate?: string, endDate?: string): Promise<any> {
  const db = getDatabase();

  const conditions: string[] = [];
  const params: any[] = [];

  conditions.push('org_id = ?'); params.push(orgId);
  if (employeeId) { conditions.push('employee_id = ?'); params.push(employeeId); }
  if (startDate) { conditions.push('timestamp >= ?'); params.push(startDate); }
  if (endDate) { conditions.push('timestamp <= ?'); params.push(endDate); }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Category breakdown
  const categoryStats = await db.all(
    `SELECT category, category_name,
            COUNT(*) as count,
            SUM(duration_seconds) as total_seconds,
            AVG(productivity_score) as avg_productivity
     FROM activities ${whereClause}
     GROUP BY category`,
    params
  );

  // Suspicious count
  const suspiciousWhere = whereClause ? `${whereClause} AND is_suspicious = 1` : 'WHERE is_suspicious = 1';
  const suspiciousCount = await db.get(
    `SELECT COUNT(*) as count FROM activities ${suspiciousWhere}`,
    params
  );

  // Average productivity score
  const avgProductivity = await db.get(
    `SELECT AVG(productivity_score) as score FROM activities ${whereClause}`,
    params
  );

  return {
    categoryBreakdown: categoryStats,
    suspiciousCount: suspiciousCount.count,
    averageProductivityScore: Math.round(avgProductivity.score || 0)
  };
}

function mapActivity(row: any): Activity {
  return {
    id: row.id,
    employeeId: row.employee_id,
    timestamp: row.timestamp,
    appName: row.app_name,
    windowTitle: row.window_title,
    category: row.category,
    categoryName: row.category_name,
    productivityScore: row.productivity_score,
    productivityLevel: row.productivity_level,
    isSuspicious: row.is_suspicious === 1,
    suspiciousReason: row.suspicious_reason,
    isIdle: row.is_idle === 1,
    idleTimeSeconds: row.idle_time_seconds,
    durationSeconds: row.duration_seconds,
    projectId: row.project_id || undefined,
    taskId: row.task_id || undefined,
    createdAt: row.created_at
  };
}
