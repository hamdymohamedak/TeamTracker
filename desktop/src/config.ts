// TeamTracker Desktop App Configuration
//
// Default server URL is chosen at build time:
//   - `pnpm run dev`  → http://localhost:3001
//   - `pnpm run build` / dist / CI → https://tracker.hostly-eg.com
// Override anytime with TEAMTRACKER_SERVER_URL (build or runtime).

/** Production dashboard (employee installers + GitHub release builds). */
export const PRODUCTION_SERVER_URL = 'https://tracker.hostly-eg.com';

/** Local admin API while developing. */
export const LOCAL_SERVER_URL = 'http://localhost:3001';

/** Injected by Vite (`--mode development` vs `production`). */
declare const __TEAMTRACKER_DEFAULT_SERVER_URL__: string | undefined;

function builtInDefaultServerUrl(): string {
  if (typeof __TEAMTRACKER_DEFAULT_SERVER_URL__ === 'string' && __TEAMTRACKER_DEFAULT_SERVER_URL__) {
    return __TEAMTRACKER_DEFAULT_SERVER_URL__.replace(/\/+$/, '');
  }
  // Fallback if somehow run without Vite define (e.g. raw tsc emit).
  return PRODUCTION_SERVER_URL;
}

export const TEAMTRACKER_CONFIG = {
  /** Build-time default; prefer getServerUrl() at runtime. */
  serverUrl: builtInDefaultServerUrl(),

  // Device auth token (from setup token enrollment)
  deviceToken: process.env.TEAMTRACKER_DEVICE_TOKEN || '',

  // Default employee settings (overridden by device token)
  defaults: {
    employeeId: 'emp-001',
    employeeName: 'Employee'
  },

  // Sync settings
  sync: {
    intervalMs: 30000,      // Sync every 30 seconds
    batchSize: 100,         // Max activities per batch
    retryDelayMs: 60000     // Retry after 1 minute on failure
  },

  // Tracking settings
  tracking: {
    checkIntervalMs: 5000,  // Check active window every 5 seconds
    idleThresholdMs: 300000 // 5 minutes of no input = idle
  }
};

/** Runtime / build default (env wins). */
export function getServerUrl(): string {
  const fromEnv = (process.env.TEAMTRACKER_SERVER_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return builtInDefaultServerUrl();
}

/** Enrolled / runtime server URL (set by tracker after load or activation). */
let runtimeServerUrl = '';

export function setRuntimeServerUrl(url: string): void {
  runtimeServerUrl = (url || '').replace(/\/+$/, '');
}

/** Prefer enrolled config.serverUrl; fall back to build-time / env default. */
export function getEffectiveServerUrl(): string {
  return (runtimeServerUrl || getServerUrl()).replace(/\/+$/, '');
}
