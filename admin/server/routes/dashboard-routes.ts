import type { Express } from 'express';
import { getDashboardStats } from '../database.js';
import { requireAuth, requireAnyAuth } from '../auth.js';

export function setupDashboardRoutes(app: Express): void {
  // Server time for clock-skew detection (authenticated)
  app.get('/api/time', requireAnyAuth, (req, res) => {
    const serverTime = Date.now();
    const clientRaw = req.query.clientTime;
    const clientTime = typeof clientRaw === 'string' ? parseInt(clientRaw, 10) : NaN;
    const clockOffsetMs = Number.isFinite(clientTime) ? serverTime - clientTime : null;
    res.json({
      success: true,
      data: {
        serverTime,
        serverTimeIso: new Date(serverTime).toISOString(),
        clientTime: Number.isFinite(clientTime) ? clientTime : null,
        clockOffsetMs,
      },
    });
  });

  // Dashboard
  app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
    try {
      const tz = typeof req.query.tz === 'string' ? req.query.tz : undefined;
      const scopeRaw = typeof req.query.scope === 'string' ? req.query.scope : 'today';
      const scope: 'today' | 'week' | 'all' =
        scopeRaw === 'week' || scopeRaw === 'all' ? scopeRaw : 'today';
      const stats = await getDashboardStats(req.orgId!, tz, scope);
      res.json({ success: true, data: stats });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });
}
