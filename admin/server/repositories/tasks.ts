import type { Task } from '../../shared-types.js';
import { getDatabase } from '../database/connection.js';

// Task operations
export async function getAllTasks(orgId: string): Promise<Task[]> {
  const db = getDatabase();
  const rows = await db.all('SELECT * FROM tasks WHERE org_id = ? ORDER BY updated_at DESC', [orgId]);
  return rows.map(mapTask);
}

export async function getTasksByProject(orgId: string, projectId: string): Promise<Task[]> {
  const db = getDatabase();
  const rows = await db.all('SELECT * FROM tasks WHERE project_id = ? AND org_id = ?', [projectId, orgId]);
  return rows.map(mapTask);
}

export async function createTask(task: Task): Promise<void> {
  const db = getDatabase();
  await db.run(
    `INSERT INTO tasks (id, org_id, project_id, name, description, status, priority, estimated_hours, assigned_to, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.id, task.orgId, task.projectId, task.name, task.description, task.status, task.priority, task.estimatedHours, task.assignedTo, task.createdAt, task.updatedAt]
  );
}

export async function updateTask(orgId: string, id: string, updates: Partial<Task>): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();

  const sets: string[] = [];
  const values: any[] = [];

  if (updates.name) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.status) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.priority) { sets.push('priority = ?'); values.push(updates.priority); }
  if (updates.assignedTo) { sets.push('assigned_to = ?'); values.push(updates.assignedTo); }

  sets.push('updated_at = ?'); values.push(now);
  values.push(id);

  values.push(orgId);
  await db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ? AND org_id = ?`, values);
}

export async function deleteTask(orgId: string, id: string): Promise<void> {
  const db = getDatabase();
  await db.run('DELETE FROM tasks WHERE id = ? AND org_id = ?', [id, orgId]);
}

function mapTask(row: any): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    status: row.status,
    priority: row.priority,
    estimatedHours: row.estimated_hours,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
