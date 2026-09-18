import type { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllEmployees,
  getEmployeeById,
  getDatabase,
} from '../database.js';
import { requireAuth } from '../auth.js';
import {
  detectEmployeeRole,
  getRoleStatus,
  ROLE_PROFILES,
} from '../role-detector.js';

export function setupRoleOverrideRoutes(app: Express): void {
  // Get detected role for an employee
  app.get('/api/roles/:employeeId', requireAuth, async (req, res) => {
    try {
      const employee = await getEmployeeById(req.orgId!, req.params.employeeId);
      if (!employee) {
        return res.status(404).json({ success: false, error: 'Employee not found' });
      }
      const role = await detectEmployeeRole(req.params.employeeId);
      const status = await getRoleStatus(req.params.employeeId);
      res.json({ success: true, data: { ...role, learningProgress: status.learningProgress, hoursTracked: status.hoursTracked } });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Get role status for all employees (for admin dashboard)
  app.get('/api/roles', requireAuth, async (req, res) => {
    try {
      const employees = await getAllEmployees(req.orgId!);
      const roles = await Promise.all(
        employees.map(async (emp) => {
          const status = await getRoleStatus(emp.id);
          return { employeeId: emp.id, employeeName: emp.name, ...status };
        })
      );
      res.json({ success: true, data: roles });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Admin override: set role for an employee
  app.put('/api/roles/:employeeId', requireAuth, async (req, res) => {
    try {
      const employee = await getEmployeeById(req.orgId!, req.params.employeeId);
      if (!employee) {
        return res.status(404).json({ success: false, error: 'Employee not found' });
      }
      const { roleType } = req.body;
      const profile = ROLE_PROFILES.find(p => p.roleType === roleType);

      if (!profile) {
        return res.status(400).json({
          success: false,
          error: `Unknown role type. Valid types: ${ROLE_PROFILES.map(p => p.roleType).join(', ')}`
        });
      }

      const db = getDatabase();
      const now = new Date().toISOString();

      await db.run(
        `INSERT OR REPLACE INTO role_profiles
         (employee_id, org_id, role_type, display_name, confidence, status, detected_at, learning_started_at, updated_at)
         VALUES (?, ?, ?, ?, 100, 'admin_override', ?, ?, ?)`,
        [req.params.employeeId, req.orgId!, roleType, profile.displayName, now, now, now]
      );

      res.json({ success: true, data: { employeeId: req.params.employeeId, roleType, displayName: profile.displayName, status: 'admin_override' } });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // List available role types
  app.get('/api/role-types', requireAuth, (req, res) => {
    res.json({
      success: true,
      data: ROLE_PROFILES.map(p => ({
        roleType: p.roleType,
        displayName: p.displayName,
        description: p.description,
        coreApps: p.coreApps.slice(0, 10), // Show first 10
        signatureThreshold: p.signatureThreshold
      }))
    });
  });

  // Classification overrides — org-scoped per-org and per-employee. The
  // admin UI lives at /overrides; the rule engine in role-detector.ts
  // already reads this table when applying overrides at activity-ingest
  // time, so adding rows here immediately changes how new activities are
  // classified for the org.
  app.get('/api/overrides', requireAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const overrides = await db.all(
        'SELECT * FROM classification_overrides WHERE org_id = ? ORDER BY created_at DESC',
        [req.orgId!]
      );
      res.json({ success: true, data: overrides });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/overrides', requireAuth, async (req, res) => {
    try {
      const { employeeId, roleType, appPattern, category, productivityScore } = req.body;

      if (!appPattern || !category || productivityScore === undefined) {
        return res.status(400).json({ success: false, error: 'appPattern, category, and productivityScore are required' });
      }

      // Validate that, if employeeId is given, it belongs to this org —
      // otherwise an admin from one org could create an override targeting
      // an employee in a different org.
      if (employeeId) {
        const empCheck = await getDatabase().get(
          'SELECT id FROM employees WHERE id = ? AND org_id = ?',
          [employeeId, req.orgId!]
        );
        if (!empCheck) {
          return res.status(400).json({ success: false, error: 'Employee not found in your organization' });
        }
      }

      const db = getDatabase();
      const id = uuidv4();
      const now = new Date().toISOString();

      await db.run(
        `INSERT INTO classification_overrides (id, org_id, employee_id, role_type, app_pattern, category, productivity_score, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, req.orgId!, employeeId || null, roleType || null, appPattern, category, productivityScore, now]
      );

      res.json({ success: true, data: { id, orgId: req.orgId, employeeId, roleType, appPattern, category, productivityScore } });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.delete('/api/overrides/:id', requireAuth, async (req, res) => {
    try {
      const db = getDatabase();
      // Scope the delete to the caller's org so one admin can't delete
      // another org's overrides by guessing IDs.
      const result: any = await db.run(
        'DELETE FROM classification_overrides WHERE id = ? AND org_id = ?',
        [req.params.id, req.orgId!]
      );
      if (result?.changes === 0) {
        return res.status(404).json({ success: false, error: 'Override not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });
}
