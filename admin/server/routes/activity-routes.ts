import type { Express } from 'express';
import {
  getActivitiesByEmployee,
  getAllActivities,
  getSuspiciousActivities,
  getActivityStats,
  getEmployeeById,
  getDatabase,
} from '../database.js';
import { requireAuth, requireAnyAuth } from '../auth.js';
import { ingestActivities } from '../services/activity-ingest.js';

export function setupActivityRoutes(app: Express): void {
  // Receive activities from desktop app
  app.post('/api/activity', requireAnyAuth, async (req, res) => {
    try {
      // Device tokens may only write their own activities; dashboard must specify employeeId
      const employeeId = req.tokenType === 'device' ? req.employeeId! : req.body.employeeId;
      const { activities } = req.body;

      if (!employeeId || !Array.isArray(activities)) {
        return res.status(400).json({
          success: false,
          error: 'Missing employeeId or activities array'
        });
      }

      // Dashboard: verify employee belongs to org
      if (req.tokenType === 'dashboard') {
        const emp = await getEmployeeById(req.orgId!, employeeId);
        if (!emp) {
          return res.status(404).json({ success: false, error: 'Employee not found' });
        }
      }

      const result = await ingestActivities(req.orgId!, employeeId, activities);

      res.json({
        success: true,
        data: {
          syncedCount: result.syncedCount,
          suspiciousCount: result.suspiciousCount,
          detectedRole: result.detectedRole
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Activity feed: paginated + filterable. Used by the Dashboard "Live
  // Activity Feed" section to support Load More + employee/category
  // filters. The 2026-04-07 audit caught that the dashboard only showed
  // the most recent 20 with no way to dig deeper or scope to one employee
  // or one category — admins had to scroll endlessly looking for context.
  app.get('/api/activity-feed', requireAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 200);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      const employeeIdFilter = typeof req.query.employeeId === 'string' && req.query.employeeId ? req.query.employeeId : null;
      const categoryFilter = typeof req.query.category === 'string' && req.query.category ? req.query.category : null;

      const SYSTEM_APPS = [
        'loginwindow', 'lockscreen', 'screensaver', 'window server', 'idle',
        'usernotificationcenter', 'controlcenter', 'dock', 'notificationcenter'
      ];
      const sysExclusion = SYSTEM_APPS.map(() => 'LOWER(a.app_name) != ?').join(' AND ');

      const where: string[] = ['a.org_id = ?'];
      const params: any[] = [req.orgId!];
      if (employeeIdFilter) {
        where.push('a.employee_id = ?');
        params.push(employeeIdFilter);
      }
      if (categoryFilter) {
        where.push('a.category = ?');
        params.push(categoryFilter);
      }
      where.push(sysExclusion);
      params.push(...SYSTEM_APPS);

      const whereSql = where.join(' AND ');

      const rows = await db.all(
        `SELECT a.*, e.name AS employee_name
           FROM activities a
           LEFT JOIN employees e ON e.id = a.employee_id AND e.org_id = a.org_id
          WHERE ${whereSql}
          ORDER BY a.timestamp DESC, a.created_at DESC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      const countRow: any = await db.get(
        `SELECT COUNT(*) as c FROM activities a WHERE ${whereSql}`,
        params
      );

      // Map to client shape
      const activities = (rows as any[]).map((r: any) => ({
        id: r.id,
        employeeId: r.employee_id,
        employeeName: r.employee_name || null,
        timestamp: r.timestamp,
        appName: r.app_name,
        windowTitle: r.window_title,
        category: r.category,
        categoryName: r.category_name,
        productivityScore: r.productivity_score,
        productivityLevel: r.productivity_level,
        isSuspicious: r.is_suspicious === 1,
        suspiciousReason: r.suspicious_reason,
        isIdle: r.is_idle === 1,
        durationSeconds: r.duration_seconds
      }));

      res.json({
        success: true,
        data: {
          activities,
          total: countRow?.c || 0,
          limit,
          offset,
          hasMore: offset + activities.length < (countRow?.c || 0)
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Get activities for an employee
  app.get('/api/activities', requireAuth, async (req, res) => {
    try {
      let activities;
      if (req.query.employeeId) {
        activities = await getActivitiesByEmployee(
          req.orgId!,
          req.query.employeeId as string,
          req.query.startDate as string,
          req.query.endDate as string
        );
      } else {
        activities = await getAllActivities(
          req.orgId!,
          req.query.startDate as string,
          req.query.endDate as string
        );
      }
      res.json({ success: true, data: activities });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Get suspicious activities
  app.get('/api/activities/suspicious', requireAuth, async (req, res) => {
    try {
      const activities = await getSuspiciousActivities(
        req.orgId!,
        req.query.employeeId as string | undefined,
        req.query.limit ? parseInt(req.query.limit as string) : 50
      );
      res.json({ success: true, data: activities });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // Get activity statistics
  app.get('/api/activities/stats', requireAuth, async (req, res) => {
    try {
      const stats = await getActivityStats(
        req.orgId!,
        req.query.employeeId as string | undefined,
        req.query.startDate as string | undefined,
        req.query.endDate as string | undefined
      );
      res.json({ success: true, data: stats });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });
}
