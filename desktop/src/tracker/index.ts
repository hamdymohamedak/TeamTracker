/**
 * Public Tracker API — the single entry-point imported by main.ts (via the
 * tracker.ts shim).  Orchestrates startup sequencing and exposes the small
 * set of functions that Electron main needs.
 */
import { startScreenshotService } from '../screenshot.js';
import { hasActiveWinModule } from '../active-window.js';
import { config, trackerState } from './state.js';
import { getEffectiveServerUrl } from '../config.js';
import {
  loadConfig,
  syncRuntimeServerUrl,
  activateFromDownloadsIfNeeded,
} from './enrollment.js';
import { loadOfflineQueue, registerQuitHooks } from './offline-queue.js';
import { syncClockSkew } from './sync.js';
import { startPeriodicTimers, startPresenceClient } from './capture-loop.js';

// ── Re-exports consumed by main.ts ────────────────────────────────────────────

export { getEffectiveServerUrl } from '../config.js';
export { enrollWithSetupToken, isEnrolled, logoutDevice } from './enrollment.js';
export { setupIpcHandlers } from './ipc.js';
export { onSystemResume } from './capture-loop.js';

// ── Public API ────────────────────────────────────────────────────────────────

export async function startTracking(): Promise<void> {
  console.log('🚀 Starting TeamTracker smart activity tracking...');

  // Load config
  loadConfig();
  syncRuntimeServerUrl();
  registerQuitHooks();

  // First-run activation: if no device token is saved, look for an
  // activation file in Downloads and redeem it for a device JWT.
  if (!config.deviceToken) {
    await activateFromDownloadsIfNeeded();
  }

  console.log(
    `Auth: token=${config.deviceToken ? 'present (' + config.deviceToken.length + ' chars)' : 'MISSING'}, ` +
    `server=${getEffectiveServerUrl()}`
  );

  // Probe window backends (active-win + Linux CLI fallbacks).
  const hasNative = await hasActiveWinModule();
  if (hasNative) {
    console.log('✓ active-win library loaded');
  } else if (process.platform === 'linux') {
    console.log('⚠️ active-win unavailable — will use Linux CLI fallbacks (xdotool / gdbus / hyprctl)');
  } else {
    console.error('Failed to load active-win — window tracking will not work on this platform');
  }

  // Load offline queue
  loadOfflineQueue();

  // Clock skew probe (informational — does not rewrite activity timestamps).
  await syncClockSkew();

  // Wire up the periodic timers.
  startPeriodicTimers();

  // Periodic screenshot capture — controlled by org-level settings on server.
  startScreenshotService(
    () => config.deviceToken || '',
    () => ({
      appName: trackerState.lastActivity?.appName,
      windowTitle: trackerState.lastActivity?.windowTitle
    })
  );

  // Live presence + on-demand screenshot commands from the admin dashboard.
  startPresenceClient();

  console.log('✓ Smart tracking active');
  console.log('✓ Employee:', config.employeeName, `(${config.employeeId})`);
  console.log('✓ Server:', getEffectiveServerUrl());
  console.log('');
  console.log('📊 Tracking:');
  console.log('  • Core work activities');
  console.log('  • Communication (Slack, Teams, Email)');
  console.log('  • Idle time detection');
  console.log('  • Suspicious patterns (video idle, ghost presence)');
  console.log('');
}

export function getTrackingStatus() {
  return {
    activitiesCount: trackerState.activities.length,
    queuedCount: trackerState.offlineQueue.length,
    queueOverflow: trackerState.queueOverflow,
    queueDropCount: trackerState.queueDropCount,
    clockOffsetMs: trackerState.clockOffsetMs,
    isOnline: trackerState.isOnline,
    lastSync: trackerState.lastSyncTime
      ? new Date(trackerState.lastSyncTime).toISOString()
      : null,
    lastActivity: trackerState.lastActivity,
    config: {
      ...config,
      deviceToken: config.deviceToken ? '***' : '',
    }
  };
}
