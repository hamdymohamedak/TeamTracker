import type { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getProjectById,
  getEmployeeActivityStats,
  getDatabase,
} from '../database.js';
import { requireAuth, revokeEmployeeDeviceSessions } from '../auth.js';
import { getConnectedEmployees } from '../websocket.js';

export function setupEmployeeRoutes(app: Express): void {
  app.get('/api/employees', requireAuth, async (req, res) => {
    try {
      const employees = await getAllEmployees(req.orgId!);
      res.json({ success: true, data: employees });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Live tracker presence (WebSocket-connected devices). Must be registered
  // before /api/employees/:id so "online" is not parsed as an id.
  app.get('/api/employees/online', requireAuth, async (req, res) => {
    try {
      const online = getConnectedEmployees(req.orgId!).map(e => ({
        employeeId: e.employeeId,
        employeeName: e.employeeName,
      }));
      res.json({ success: true, data: online });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Get employee activity with productivity metrics
  app.get('/api/employees/activity', requireAuth, async (req, res) => {
    try {
      const activities = await getEmployeeActivityStats(req.orgId!);
      res.json({ success: true, data: activities });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get('/api/employees/:id', requireAuth, async (req, res) => {
    try {
      const employee = await getEmployeeById(req.orgId!, req.params.id);
      if (!employee) {
        return res.status(404).json({ success: false, error: 'Employee not found' });
      }
      res.json({ success: true, data: employee });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/employees', requireAuth, async (req, res) => {
    try {
      const now = new Date().toISOString();
      const employee = {
        id: uuidv4(),
        ...req.body,
        orgId: req.orgId!,
        role: req.body.role || 'employee',
        createdAt: now,
        updatedAt: now
      };
      await createEmployee(employee);
      res.json({ success: true, data: employee });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.put('/api/employees/:id', requireAuth, async (req, res) => {
    try {
      await updateEmployee(req.orgId!, req.params.id, req.body);
      // Optional active project/task assignment for activity stamping
      if ('activeProjectId' in (req.body || {}) || 'activeTaskId' in (req.body || {})) {
        const db = getDatabase();
        let projectId = req.body.activeProjectId ?? null;
        let taskId = req.body.activeTaskId ?? null;
        if (projectId) {
          const p = await getProjectById(req.orgId!, projectId);
          if (!p) return res.status(400).json({ success: false, error: 'Invalid activeProjectId' });
        }
        if (taskId) {
          const t = await db.get(`SELECT id, project_id FROM tasks WHERE id = ? AND org_id = ?`, [taskId, req.orgId!]);
          if (!t) return res.status(400).json({ success: false, error: 'Invalid activeTaskId' });
          if (projectId && t.project_id !== projectId) {
            return res.status(400).json({ success: false, error: 'activeTaskId does not belong to activeProjectId' });
          }
        }
        await db.run(
          `UPDATE employees SET active_project_id = ?, active_task_id = ?, updated_at = ? WHERE id = ? AND org_id = ?`,
          [projectId, taskId, new Date().toISOString(), req.params.id, req.orgId!]
        );
      }
      const employee = await getEmployeeById(req.orgId!, req.params.id);
      res.json({ success: true, data: employee });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.delete('/api/employees/:id', requireAuth, async (req, res) => {
    try {
      await deleteEmployee(req.orgId!, req.params.id);
      await revokeEmployeeDeviceSessions(req.orgId!, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });
}
