import type { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  getAllTimeEntries,
  getTimeEntriesByEmployee,
  createTimeEntry,
  updateTimeEntry,
  getActiveTimeEntries,
} from '../database.js';
import { requireAuth } from '../auth.js';

// ─────────────────────────────────────────────────────────────────────────
// DEPRECATED: Legacy Time Entries
// ---------------------------------------------------------------------------
// The `time_entries` table predates the `activities` table that the
// smart tracker now writes to. Nothing in the current desktop tracker
// uses these endpoints, but they're kept for one release cycle so any
// straggling consumer doesn't 404. New endpoints (`/api/activity`,
// `/api/reports/productivity`, `/api/reports/daily-summary`) supersede
// them. Schedule for removal: 2026-05-01.
//
// Each handler now sets a Deprecation header so any caller can see in
// their network panel that they're hitting a legacy path.
// ─────────────────────────────────────────────────────────────────────────
const markDeprecated = (res: any) => {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Fri, 01 May 2026 00:00:00 GMT');
  res.setHeader('Link', '</api/reports/productivity>; rel="successor-version"');
};

export function setupTimeEntryRoutes(app: Express): void {
  app.get('/api/time-entries', requireAuth, async (req, res) => {
    markDeprecated(res);
    try {
      let entries;
      if (req.query.employeeId) {
        entries = await getTimeEntriesByEmployee(
          req.orgId!,
          req.query.employeeId as string,
          req.query.startDate as string,
          req.query.endDate as string
        );
      } else {
        entries = await getAllTimeEntries(
          req.orgId!,
          req.query.startDate as string,
          req.query.endDate as string
        );
      }
      res.json({ success: true, data: entries });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get('/api/time-entries/active', requireAuth, async (req, res) => {
    markDeprecated(res);
    try {
      const entries = await getActiveTimeEntries(req.orgId!);
      res.json({ success: true, data: entries });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/time-entries', requireAuth, async (req, res) => {
    markDeprecated(res);
    try {
      const now = new Date().toISOString();
      const entry = {
        id: uuidv4(),
        ...req.body,
        createdAt: now,
        updatedAt: now
      };
      await createTimeEntry(req.orgId!, entry);
      res.json({ success: true, data: entry });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.put('/api/time-entries/:id', requireAuth, async (req, res) => {
    markDeprecated(res);
    try {
      await updateTimeEntry(req.orgId!, req.params.id, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });
}
