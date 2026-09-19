/**
 * Express application factory — used by production bootstrap and HTTP tests.
 * Does not listen; does not start schedulers.
 */
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { validateEnv } from '../env.js';
import { getPaths } from '../paths.js';
import { getDatabase } from '../database.js';
import { setupRoutes } from '../routes.js';
import aiRoutes from '../routes/ai-routes.js';
import aiLLMRoutes from '../routes/ai-routes-llm.js';
import { setupAuthRoutes } from '../routes/auth-routes.js';
import { setupOrgRoutes } from '../routes/org-routes.js';
import { setupSummaryScreenshotRoutes } from '../routes/summary-screenshot-routes.js';
import { requireAuth } from '../auth.js';
import { setupLanRoutes } from '../lan-discovery.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type CreateAppOptions = {
  /** When true, /api/ready reports ready (tests set after initDatabase). */
  ready?: boolean;
  /** Skip static SPA hosting (tests). Default false in production path. */
  skipStatic?: boolean;
};

let readyFlag = false;

export function setAppReady(ready: boolean): void {
  readyFlag = ready;
}

export function isAppReady(): boolean {
  return readyFlag;
}

function findStaticPath(): string {
  const possiblePaths = [
    path.join(__dirname, '../../client'),
    path.join(__dirname, '../../../dist/client'),
    path.join(__dirname, '../../../admin/dist/client'),
    '/opt/teamtracker/application/admin/dist/client',
    '/opt/teamtracker/admin/dist/client',
  ];

  for (const staticPath of possiblePaths) {
    if (fs.existsSync(path.join(staticPath, 'index.html'))) {
      return staticPath;
    }
  }
  return possiblePaths[0];
}

export function createApp(options: CreateAppOptions = {}): Express {
  const env = validateEnv();
  if (options.ready) readyFlag = true;

  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  app.get('/api/ready', async (_req, res) => {
    if (!readyFlag) {
      return res.status(503).json({
        status: 'not_ready',
        reason: 'starting',
        timestamp: new Date().toISOString(),
      });
    }
    try {
      const db = getDatabase();
      await db.get('SELECT 1 AS ok');
      const { databasePath, uploadsDir, backupsDir } = getPaths();
      const checks = {
        database: fs.existsSync(databasePath),
        uploads: fs.existsSync(uploadsDir),
        backups: fs.existsSync(backupsDir),
      };
      const ok = checks.database && checks.uploads;
      res.status(ok ? 200 : 503).json({
        status: ok ? 'ready' : 'degraded',
        checks,
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: 'not_ready',
        reason: 'database_unavailable',
        timestamp: new Date().toISOString(),
      });
    }
  });

  setupLanRoutes(app, env.port);
  setupAuthRoutes(app);
  setupOrgRoutes(app);
  setupSummaryScreenshotRoutes(app);
  setupRoutes(app);
  app.use('/api/ai', aiRoutes);
  app.use('/api/ai-llm', aiLLMRoutes);

  const { uploadsDir, screenshotsDir } = getPaths();
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  const authScreenshot = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.authorization && typeof req.query.token === 'string') {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    return requireAuth(req, res, next);
  };

  app.get(/^\/api\/screenshots\/file\/(.+)$/, authScreenshot, async (req, res) => {
    try {
      const rel = decodeURIComponent(req.params[0] || '').replace(/^\/+/, '');
      if (!rel.startsWith(req.orgId! + '/') && !rel.startsWith(req.orgId! + path.sep)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const abs = path.resolve(screenshotsDir, rel);
      if (!abs.startsWith(path.resolve(screenshotsDir) + path.sep)) {
        return res.status(400).json({ success: false, error: 'Invalid path' });
      }
      if (!fs.existsSync(abs)) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }
      res.sendFile(abs);
    } catch {
      res.status(500).json({ success: false, error: 'Failed to serve file' });
    }
  });

  app.get(/^\/uploads\/screenshots\/(.+)$/, authScreenshot, async (req, res) => {
    try {
      const rel = decodeURIComponent(req.params[0] || '').replace(/^\/+/, '');
      if (!rel.startsWith(req.orgId! + '/')) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }
      const abs = path.resolve(screenshotsDir, rel);
      if (!abs.startsWith(path.resolve(screenshotsDir) + path.sep)) {
        return res.status(400).json({ success: false, error: 'Invalid path' });
      }
      if (!fs.existsSync(abs)) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }
      res.sendFile(abs);
    } catch {
      res.status(500).json({ success: false, error: 'Failed to serve file' });
    }
  });

  app.use('/uploads', (req, res, next) => {
    if (req.path.startsWith('/screenshots')) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    return express.static(uploadsDir, { maxAge: '1d', fallthrough: true })(req, res, next);
  });

  if (!options.skipStatic) {
    const staticPath = findStaticPath();
    app.use(express.static(staticPath));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
        const indexPath = path.join(staticPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).json({
            error: 'Dashboard not built',
            message: 'Client files not found. Run npm run build.',
          });
        }
      }
    });
  }

  return app;
}
