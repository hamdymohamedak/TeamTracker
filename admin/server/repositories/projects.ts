import type { Project } from '../../shared-types.js';
import { getDatabase } from '../database/connection.js';

// Project operations
export async function getAllProjects(orgId: string): Promise<Project[]> {
  const db = getDatabase();
  const rows = await db.all('SELECT * FROM projects WHERE org_id = ? ORDER BY name', [orgId]);
  return rows.map(mapProject);
}

export async function getProjectById(orgId: string, id: string): Promise<Project | null> {
  const db = getDatabase();
  const row = await db.get('SELECT * FROM projects WHERE id = ? AND org_id = ?', [id, orgId]);
  return row ? mapProject(row) : null;
}

export async function createProject(project: Project): Promise<void> {
  const db = getDatabase();
  await db.run(
    `INSERT INTO projects (id, org_id, name, description, client_name, status, start_date, end_date, budget, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [project.id, project.orgId, project.name, project.description, project.clientName, project.status, project.startDate, project.endDate, project.budget, project.createdAt, project.updatedAt]
  );
}

export async function updateProject(orgId: string, id: string, updates: Partial<Project>): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const sets: string[] = [];
  const values: any[] = [];

  if (updates.name) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.clientName) { sets.push('client_name = ?'); values.push(updates.clientName); }
  if (updates.status) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.budget !== undefined) { sets.push('budget = ?'); values.push(updates.budget); }

  sets.push('updated_at = ?'); values.push(now);
  values.push(id);

  values.push(orgId);
  await db.run(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`, values);
}

/**
 * Hard-delete a project. Any tasks under it are also deleted first so
 * we don't leave orphaned task rows with a dangling project_id FK.
 * Scoped to `orgId` so one org can never delete another's data.
 */
export async function deleteProject(orgId: string, id: string): Promise<void> {
  const db = getDatabase();
  await db.run('DELETE FROM tasks WHERE project_id = ? AND org_id = ?', [id, orgId]);
  await db.run('DELETE FROM projects WHERE id = ? AND org_id = ?', [id, orgId]);
}

function mapProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    clientName: row.client_name,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    budget: row.budget,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
