import type { Express } from 'express';
import {
  getTimeEntriesByEmployee,
  getAllTimeEntries,
  getDatabase,
} from '../database.js';
import { requireAuth } from '../auth.js';

export function setupReportRoutes(app: Express): void {
  // Reports
  app.get('/api/reports/summary', requireAuth, async (req, res) => {
    try {
      const { employeeId, projectId, startDate, endDate } = req.query;

      let entries;
      if (employeeId) {
        entries = await getTimeEntriesByEmployee(req.orgId!, employeeId as string, startDate as string, endDate as string);
      } else {
        entries = await getAllTimeEntries(req.orgId!, startDate as string, endDate as string);
      }

      if (projectId) {
        entries = entries.filter(e => e.projectId === projectId);
      }

      const totalSeconds = entries.reduce((sum, e) => sum + (e.duration || 0), 0);
      const billableSeconds = entries.filter(e => e.isBillable).reduce((sum, e) => sum + (e.duration || 0), 0);

      res.json({
        success: true,
        data: {
          entries,
          totalHours: Math.round(totalSeconds / 3600 * 10) / 10,
          billableHours: Math.round(billableSeconds / 3600 * 10) / 10,
          entryCount: entries.length
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // NEW: Productivity report — unified formula + timezone-aware + business hours
  app.get('/api/reports/productivity', requireAuth, async (req, res) => {
    try {
      const { employeeId, startDate, endDate } = req.query;
      const viewTz = typeof req.query.tz === 'string' ? req.query.tz : undefined;

      if (!employeeId) {
        return res.status(400).json({ success: false, error: 'employeeId is required' });
      }

      // Load org + employee up front so we can resolve tz + business hours.
      const db = getDatabase();
      const orgRow = await db.get('SELECT timezone FROM organizations WHERE id = ?', [req.orgId!]);
      const { resolveTimezone, getLocalDateRangeBounds } = await import('../timezone.js');
      const tz = resolveTimezone(viewTz || orgRow?.timezone);

      // Resolve client-side date range (YYYY-MM-DD) into UTC window using tz.
      const [rangeStartUtc, rangeEndUtc] = getLocalDateRangeBounds(
        (startDate as string) || new Date().toISOString().slice(0, 10),
        (endDate as string) || new Date().toISOString().slice(0, 10),
        tz
      );

      // Pull raw employee row so we get the business-hours columns too.
      const empRow = await db.get(
        `SELECT * FROM employees WHERE id = ? AND org_id = ?`,
        [employeeId, req.orgId!]
      );
      if (!empRow) {
        return res.status(404).json({ success: false, error: 'Employee not found' });
      }

      // Pull the raw activities window using the tz-aware UTC bounds (strictly <).
      const rawActivities = await db.all(
        `SELECT * FROM activities
          WHERE employee_id = ? AND org_id = ?
            AND timestamp >= ? AND timestamp < ?
          ORDER BY timestamp ASC`,
        [employeeId, req.orgId!, rangeStartUtc, rangeEndUtc]
      );

      // Map to typed objects
      const mapped = (rawActivities as any[]).map((row: any) => ({
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
        createdAt: row.created_at
      }));

      // Annotate each activity with `outsideBusinessHours` (true when employee
      // has BH configured AND this timestamp falls outside them). When they
      // don't, everything is counted (24/7 solopreneur mode).
      const { annotateOutsideHours, hasBusinessHours } = await import('../business-hours.js');
      const annotated = hasBusinessHours(empRow)
        ? annotateOutsideHours(mapped, empRow, tz)
        : mapped.map(a => ({ ...a, outsideBusinessHours: false }));

      // Unified stats (single source of truth).
      const { computeProductivityStats } = await import('../../shared-types.js');
      const stats = computeProductivityStats(annotated);

      // Per-day trend, also using the unified formula for consistency.
      const dailyBuckets = new Map<string, typeof annotated>();
      for (const a of annotated) {
        // group by local-date (respecting tz)
        const localYmd = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(new Date(a.timestamp));
        if (!dailyBuckets.has(localYmd)) dailyBuckets.set(localYmd, []);
        dailyBuckets.get(localYmd)!.push(a);
      }

      const dailyTrend = Array.from(dailyBuckets.entries())
        .map(([date, list]) => {
          const s = computeProductivityStats(list);
          return {
            date,
            productivityScore: s.productivityScore,
            productiveMinutes: Math.round(s.productiveSeconds / 60),
            unproductiveMinutes: Math.round(s.unproductiveSeconds / 60),
            idleMinutes: Math.round(s.idleSeconds / 60),
            outsideHoursMinutes: Math.round(s.outsideHoursSeconds / 60),
            totalMinutes: Math.round(s.totalSeconds / 60)
          };
        })
        .sort((a, b) => a.date.localeCompare(b.date));

      // Category breakdown keyed by canonical id (client renders via CATEGORY_DISPLAY_NAMES).
      const categoryBreakdownSeconds: Record<string, number> = { ...stats.categorySeconds };

      // Suspicious activities — filter out system apps and cap at 50.
      const systemApps = new Set([
        'loginwindow', 'lockscreen', 'screensaver', 'window server', 'idle',
        'usernotificationcenter', 'controlcenter', 'dock', 'notificationcenter'
      ]);
      const suspiciousList = annotated
        .filter((a: any) => a.isSuspicious && !systemApps.has((a.appName || '').toLowerCase()))
        .slice(0, 50);

      res.json({
        success: true,
        data: {
          employeeId: employeeId as string,
          employeeName: empRow.name,
          dateRange: { start: startDate, end: endDate },
          timezone: tz,
          hasBusinessHours: hasBusinessHours(empRow),
          // SECONDS fields are the source of truth; hours kept for back-compat.
          summary: {
            totalSeconds:        stats.totalSeconds,
            productiveSeconds:   stats.productiveSeconds,
            unproductiveSeconds: stats.unproductiveSeconds,
            neutralSeconds:      stats.neutralSeconds,
            idleSeconds:         stats.idleSeconds,
            outsideHoursSeconds: stats.outsideHoursSeconds,
            totalHours:         Math.round(stats.totalSeconds       / 3600 * 100) / 100,
            productiveHours:    Math.round(stats.productiveSeconds  / 3600 * 100) / 100,
            unproductiveHours:  Math.round(stats.unproductiveSeconds/ 3600 * 100) / 100,
            neutralHours:       Math.round(stats.neutralSeconds     / 3600 * 100) / 100,
            idleHours:          Math.round(stats.idleSeconds        / 3600 * 100) / 100,
            outsideHoursHours:  Math.round(stats.outsideHoursSeconds/ 3600 * 100) / 100,
            averageProductivityScore: stats.productivityScore,
            focusScore: stats.productivityScore // alias
          },
          categoryBreakdownSeconds,
          // Legacy: keep the old minute-valued breakdown keyed by display name
          // so any older UI build that hits this endpoint still renders.
          categoryBreakdown: Object.fromEntries(
            Object.entries(categoryBreakdownSeconds).map(([cat, sec]) => [
              cat, Math.round(sec / 60)
            ])
          ),
          suspiciousActivities: suspiciousList,
          dailyTrend
        }
      });
    } catch (error) {
      console.error('Productivity report failed:', error);
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  // CSV export of an employee's activity rows for a date range. Used by
  // the Reports page "Export CSV" button — solves the "no raw data export
  // for payroll/invoicing" gap from DEFERRED.md. Returns a real CSV with
  // a `Content-Disposition: attachment` header so browsers download it.
  app.get('/api/reports/export.csv', requireAuth, async (req, res) => {
    try {
      const { employeeId, startDate, endDate } = req.query;
      if (!employeeId || !startDate || !endDate) {
        return res.status(400).json({ success: false, error: 'employeeId, startDate, and endDate are required' });
      }
      const viewTz = typeof req.query.tz === 'string' ? req.query.tz : undefined;
      const db = getDatabase();
      const orgRow = await db.get('SELECT timezone FROM organizations WHERE id = ?', [req.orgId!]);
      const { resolveTimezone, getLocalDateRangeBounds } = await import('../timezone.js');
      const tz = resolveTimezone(viewTz || orgRow?.timezone);
      const [startUtc, endUtc] = getLocalDateRangeBounds(startDate as string, endDate as string, tz);

      const rows: any[] = await db.all(
        `SELECT a.timestamp, a.app_name, a.window_title, a.category, a.category_name,
                a.productivity_score, a.productivity_level, a.is_idle, a.is_suspicious,
                a.duration_seconds, e.name as employee_name
         FROM activities a
         LEFT JOIN employees e ON a.employee_id = e.id
         WHERE a.employee_id = ? AND a.org_id = ?
           AND a.timestamp >= ? AND a.timestamp < ?
         ORDER BY a.timestamp ASC`,
        [employeeId, req.orgId!, startUtc, endUtc]
      );

      const escape = (v: any): string => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        // Quote if contains comma, quote, or newline
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };

      const header = [
        'timestamp_utc', 'employee', 'app', 'window_title', 'category', 'category_name',
        'productivity_score', 'productivity_level', 'is_idle', 'is_suspicious', 'duration_seconds'
      ];
      const lines = [header.join(',')];
      for (const r of rows) {
        lines.push([
          r.timestamp,
          r.employee_name,
          r.app_name,
          r.window_title,
          r.category,
          r.category_name,
          r.productivity_score,
          r.productivity_level,
          r.is_idle,
          r.is_suspicious,
          r.duration_seconds
        ].map(escape).join(','));
      }
      const csv = lines.join('\n') + '\n';

      const filename = `teamtracker-${(employeeId as string).slice(0, 8)}-${startDate}-${endDate}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      console.error('CSV export failed:', error);
      res.status(500).json({ success: false, error: String(error) });
    }
  });
}
