import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import type { Request, Response, NextFunction } from 'express';
import { validateEnv, envSummary } from './env.js';
import { getPaths, ensureDataDirectories } from './paths.js';
import { logger } from './logger.js';
import { initDatabase, getDatabase } from './database.js';
import { setupRoutes } from './routes.js';
import { setupWebSocket } from './websocket.js';
import aiRoutes from './routes/ai-routes.js';
import aiLLMRoutes from './routes/ai-routes-llm.js';
import { setupAuthRoutes } from './routes/auth-routes.js';
import { setupOrgRoutes } from './routes/org-routes.js';
import { setupSummaryScreenshotRoutes } from './routes/summary-screenshot-routes.js';
import { startDailySummaryScheduler } from './daily-summary.js';
import { startScreenshotRetentionScheduler } from './screenshot-retention.js';
import { startBackupScheduler } from './backup.js';
import { requireAuth } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fail fast on bad production config before opening ports
const env = validateEnv();
ensureDataDirectories();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = env.port;

app.set('trust proxy', 1);
app.use(cors({ origin: env.corsOrigin }));
// Activity syncs can be large; screenshots use dedicated body parser on that route
app.use(express.json({ limit: '10mb' }));

let serverReady = false;
let startupError: string | null = null;

/** Liveness — process is up (no sensitive data). */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

/** Readiness — DB + storage usable. */
app.get('/api/ready', async (_req, res) => {
  if (!serverReady) {
    return res.status(503).json({
      status: 'not_ready',
      reason: startupError || 'starting',
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
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      reason: 'database_unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

function findStaticPath(): string {
  const possiblePaths = [
    path.join(__dirname, '../client'),
    path.join(__dirname, '../../dist/client'),
    path.join(__dirname, '../../admin/dist/client'),
    '/opt/teamtracker/application/admin/dist/client',
    '/opt/teamtracker/admin/dist/client',
  ];

  for (const staticPath of possiblePaths) {
    if (fs.existsSync(path.join(staticPath, 'index.html'))) {
      logger.info('Found static files', { path: staticPath });
      return staticPath;
    }
  }

  logger.warn('No static files found; using default', { path: possiblePaths[0] });
  return possiblePaths[0];
}

async function startServer() {
  try {
    logger.info('TeamTracker server starting', envSummary(env));
    logger.info('Data paths', getPaths());

    await initDatabase();
    logger.info('Database initialized');

    setupWebSocket(wss);
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
      // Allow Bearer header OR ?token= for <img src> (cannot set Authorization)
      if (!req.headers.authorization && typeof req.query.token === 'string') {
        req.headers.authorization = `Bearer ${req.query.token}`;
      }
      return requireAuth(req, res, next);
    };

    // Authenticated screenshot file download — prevents cross-tenant URL leakage
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

    // Backward-compat: /uploads/screenshots/... requires auth (Bearer or ?token=)
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

    // Logos and other non-screenshot uploads (logo files live at uploads root)
    app.use('/uploads', (req, res, next) => {
      if (req.path.startsWith('/screenshots')) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }
      return express.static(uploadsDir, { maxAge: '1d', fallthrough: true })(req, res, next);
    });

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

    startDailySummaryScheduler();
    startScreenshotRetentionScheduler();
    startBackupScheduler();

    server.listen(PORT, () => {
      serverReady = true;
      logger.info('TeamTracker server listening', {
        port: PORT,
        health: `/api/health`,
        ready: `/api/ready`,
      });
    });
  } catch (error) {
    startupError = String(error);
    serverReady = false;
    logger.error('FATAL: Server startup failed', { error: String(error) });
    process.exit(1);
  }
}

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection', { error: String(error) });
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: String(error) });
  process.exit(1);
});

startServer();
