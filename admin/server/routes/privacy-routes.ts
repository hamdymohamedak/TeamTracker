import type { Express } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database.js';
import { requireAuth } from '../auth.js';
import { parsePrivacyAliases, aliasesToJson, normalizePrivacyPattern } from '../privacy-util.js';

export function setupPrivacyRoutes(app: Express): void {
  // Capture privacy blocks — skip screenshots / live view when app, window
  // title, admin aliases, or browser tab URL matches (org-wide or per-employee).
  app.get('/api/privacy-blocks', requireAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const rows = await db.all(
        `SELECT id, org_id, employee_id, app_pattern, aliases, block_screenshots, block_live_view, created_at
         FROM capture_privacy_blocks WHERE org_id = ? ORDER BY created_at DESC`,
        [req.orgId!]
      );
      res.json({
        success: true,
        data: (rows || []).map((r: any) => ({
          ...r,
          aliases: parsePrivacyAliases(r.aliases),
        })),
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/privacy-blocks', requireAuth, async (req, res) => {
    try {
      const {
        employeeId,
        appPattern,
        aliases: aliasesRaw,
        blockScreenshots = true,
        blockLiveView = true,
      } = req.body || {};

      if (!appPattern || typeof appPattern !== 'string' || !appPattern.trim()) {
        return res.status(400).json({ success: false, error: 'appPattern is required' });
      }
      if (!blockScreenshots && !blockLiveView) {
        return res.status(400).json({ success: false, error: 'At least one of blockScreenshots or blockLiveView must be enabled' });
      }

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
      // URL/host patterns → canonical hostname; app names kept as trimmed text.
      const { stored: pattern, host: normalizedHost } = normalizePrivacyPattern(appPattern);
      const aliases = parsePrivacyAliases(aliasesRaw);
      const aliasesJson = aliasesToJson(aliases);

      await db.run(
        `INSERT INTO capture_privacy_blocks
          (id, org_id, employee_id, app_pattern, aliases, block_screenshots, block_live_view, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          req.orgId!,
          employeeId || null,
          pattern,
          aliasesJson,
          blockScreenshots ? 1 : 0,
          blockLiveView ? 1 : 0,
          now,
        ]
      );

      res.json({
        success: true,
        data: {
          id,
          orgId: req.orgId,
          employeeId: employeeId || null,
          appPattern: pattern,
          normalizedHost,
          aliases,
          blockScreenshots: !!blockScreenshots,
          blockLiveView: !!blockLiveView,
          createdAt: now,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.delete('/api/privacy-blocks/:id', requireAuth, async (req, res) => {
    try {
      const db = getDatabase();
      const result: any = await db.run(
        'DELETE FROM capture_privacy_blocks WHERE id = ? AND org_id = ?',
        [req.params.id, req.orgId!]
      );
      if (result?.changes === 0) {
        return res.status(404).json({ success: false, error: 'Privacy block not found' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: String(error) });
    }
  });
}
