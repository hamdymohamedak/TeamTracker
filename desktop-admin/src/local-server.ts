/**
 * Spawn the bundled TeamTracker admin server inside Electron (local office mode).
 */
import { app } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as http from 'http';

const LOCAL_PORT = 3001;
export const LOCAL_ADMIN_URL = `http://127.0.0.1:${LOCAL_PORT}`;

let child: ChildProcess | null = null;
let starting: Promise<void> | null = null;

export function shouldEmbedLocalServer(): boolean {
  if (process.env.TEAMTRACKER_EMBED_SERVER === '0' || process.env.TEAMTRACKER_EMBED_SERVER === 'false') {
    return false;
  }
  if (process.env.TEAMTRACKER_EMBED_SERVER === '1' || process.env.TEAMTRACKER_EMBED_SERVER === 'true') {
    return true;
  }
  return app.isPackaged;
}

function serverBundleRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'admin-server');
  }
  // Dev: desktop-admin/server-bundle
  return path.join(app.getAppPath(), 'server-bundle');
}

function secretsPath(): string {
  return path.join(app.getPath('userData'), 'local-server-secrets.json');
}

function loadOrCreateJwtSecret(): string {
  const p = secretsPath();
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as { jwtSecret?: string };
      if (raw.jwtSecret && raw.jwtSecret.length >= 32) return raw.jwtSecret;
    }
  } catch {
    /* regenerate */
  }
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ jwtSecret, createdAt: new Date().toISOString() }, null, 2), {
    mode: 0o600,
  });
  return jwtSecret;
}

function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      req.on('error', () => retry());
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Local server did not become ready within ${timeoutMs}ms`));
        return;
      }
      setTimeout(attempt, 400);
    };
    attempt();
  });
}

export function isLocalServerRunning(): boolean {
  return !!(child && !child.killed);
}

export async function startLocalServer(): Promise<string> {
  if (child && !child.killed) return LOCAL_ADMIN_URL;
  if (starting) {
    await starting;
    return LOCAL_ADMIN_URL;
  }

  starting = (async () => {
    const root = serverBundleRoot();
    const entry = path.join(root, 'dist', 'server', 'index.js');
    if (!fs.existsSync(entry)) {
      throw new Error(
        `Embedded admin server not found at ${entry}. Run: node scripts/bundle-admin-server.mjs`
      );
    }

    const dataDir = path.join(app.getPath('userData'), 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const jwtSecret = loadOrCreateJwtSecret();

    const logPath = path.join(app.getPath('userData'), 'local-server.log');
    const logFd = fs.openSync(logPath, 'a');

    child = spawn(process.execPath, [entry], {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: String(LOCAL_PORT),
        JWT_SECRET: jwtSecret,
        DATA_DIR: dataDir,
        TEAMTRACKER_LAN_DISCOVERY: process.env.TEAMTRACKER_LAN_DISCOVERY || '1',
        // Avoid picking up a developer .env that points at VPS paths
        DOTENV_CONFIG_PATH: path.join(dataDir, '.env.ignore'),
      },
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });

    child.on('exit', (code, signal) => {
      console.warn(`[local-server] exited code=${code} signal=${signal}`);
      child = null;
    });

    try {
      await waitForReady(`${LOCAL_ADMIN_URL}/api/ready`, 60000);
    } catch (err) {
      stopLocalServer();
      throw err;
    }
  })();

  try {
    await starting;
  } finally {
    starting = null;
  }
  return LOCAL_ADMIN_URL;
}

export function stopLocalServer(): void {
  if (!child) return;
  const proc = child;
  child = null;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore', windowsHide: true });
    } else {
      proc.kill('SIGTERM');
      setTimeout(() => {
        try {
          if (!proc.killed) proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 3000).unref();
    }
  } catch {
    /* ignore */
  }
}

export async function restartLocalServer(): Promise<string> {
  stopLocalServer();
  await new Promise((r) => setTimeout(r, 500));
  return startLocalServer();
}
