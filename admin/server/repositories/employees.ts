import type { Employee } from '../../shared-types.js';
import { getDatabase } from '../database/connection.js';

// Employee operations
export async function getAllEmployees(orgId: string): Promise<Employee[]> {
  const db = getDatabase();
  const rows = await db.all('SELECT * FROM employees WHERE is_active = 1 AND org_id = ? ORDER BY name', [orgId]);
  return rows.map(mapEmployee);
}

export async function getEmployeeById(orgId: string, id: string): Promise<Employee | null> {
  const db = getDatabase();
  const row = await db.get('SELECT * FROM employees WHERE id = ? AND org_id = ?', [id, orgId]);
  return row ? mapEmployee(row) : null;
}

export async function createEmployee(employee: Employee): Promise<void> {
  const db = getDatabase();
  await db.run(
    `INSERT INTO employees (
      id, org_id, name, email, role, department, hourly_rate,
      currency, timezone, business_hours_start, business_hours_end, business_hours_days,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      employee.id, employee.orgId, employee.name, employee.email || null, employee.role,
      employee.department || null, employee.hourlyRate ?? null,
      employee.currency || null, employee.timezone || null,
      employee.businessHoursStart || null, employee.businessHoursEnd || null, employee.businessHoursDays || null,
      employee.createdAt, employee.updatedAt
    ]
  );
}

export async function updateEmployee(orgId: string, id: string, updates: Partial<Employee>): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const sets: string[] = [];
  const values: any[] = [];

  if (updates.name) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.email) { sets.push('email = ?'); values.push(updates.email); }
  if (updates.role) { sets.push('role = ?'); values.push(updates.role); }
  if (updates.department !== undefined) { sets.push('department = ?'); values.push(updates.department || null); }
  if (updates.hourlyRate !== undefined) { sets.push('hourly_rate = ?'); values.push(updates.hourlyRate); }
  if (updates.currency !== undefined) { sets.push('currency = ?'); values.push(updates.currency || null); }
  if (updates.timezone !== undefined) { sets.push('timezone = ?'); values.push(updates.timezone || null); }
  if (updates.businessHoursStart !== undefined) { sets.push('business_hours_start = ?'); values.push(updates.businessHoursStart || null); }
  if (updates.businessHoursEnd !== undefined) { sets.push('business_hours_end = ?'); values.push(updates.businessHoursEnd || null); }
  if (updates.businessHoursDays !== undefined) { sets.push('business_hours_days = ?'); values.push(updates.businessHoursDays || null); }

  sets.push('updated_at = ?'); values.push(now);
  values.push(id);
  values.push(orgId);

  await db.run(`UPDATE employees SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`, values);
}

export async function deleteEmployee(orgId: string, id: string): Promise<void> {
  const db = getDatabase();
  await db.run('UPDATE employees SET is_active = 0 WHERE id = ? AND org_id = ?', [id, orgId]);
}

function mapEmployee(row: any): Employee {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    department: row.department,
    hourlyRate: row.hourly_rate,
    currency: row.currency,
    timezone: row.timezone,
    businessHoursStart: row.business_hours_start,
    businessHoursEnd: row.business_hours_end,
    businessHoursDays: row.business_hours_days,
    isActive: row.is_active === 1,
    orgId: row.org_id,
    activeProjectId: row.active_project_id || undefined,
    activeTaskId: row.active_task_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
