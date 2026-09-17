import { powerMonitor, ipcMain, safeStorage, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getServerUrl, getEffectiveServerUrl, setRuntimeServerUrl, TEAMTRACKER_CONFIG } from './config.js';
import {
  classifyActivity,
  generateDailySummary,
  ActivityCategory,
} from './classifier.js';
import { startScreenshotService, getShowPrivacyBlocksToEmployees } from './screenshot.js';
import { getCapturePrivacyBlocks, getPrivacyUrlMode } from './privacy-guard.js';
import { startRemoteCommandClient, stopRemoteCommandClient } from './remote.js';
import { getActiveWindow, hasActiveWinModule } from './active-window.js';

interface TrackedActivity {
  id: string;
  timestamp: string;
  appName: string;
  windowTitle: string;
  category: ActivityCategory;
  categoryName: string;
  productivityScore: number;
  productivityLevel: 'productive' | 'neutral' | 'unproductive' | 'idle';
  isSuspicious: boolean;
  suspiciousReason?: string;
  isIdle: boolean;
  idleTimeSeconds: number;
  durationSeconds: number;
  hasInputActivity: boolean;
}

interface Config {
  employeeId: string;
  employeeName: string;
  serverUrl: string;
  deviceToken?: string;
  /** Optional active project for activity payload (set via IPC / updateConfig). */
  activeProjectId?: string;
  /** Optional active task for activity payload (set via IPC / updateConfig). */
  activeTaskId?: string;
}

const MAX_QUEUE = 5000;
const QUEUE_SAVE_DEBOUNCE_MS = 2000;
const CLOCK_SKEW_WARN_MS = 5 * 60 * 1000;
const SYNC_BACKOFF_INITIAL_MS = 1000;
const SYNC_BACKOFF_MAX_MS = 60_000;

// Activity tracking state
const activities: TrackedActivity[] = [];
const offlineQueue: TrackedActivity[] = [];
let lastActivity: TrackedActivity | null = null;
let lastSyncTime = 0;
let isOnline = true;
let queueOverflow = false;
let queueDropCount = 0;
let queueSaveTimer: NodeJS.Timeout | null = null;
let syncBackoffMs = SYNC_BACKOFF_INITIAL_MS;
let nextSyncAllowedAt = 0;
/** serverTime - clientTime from last /api/time probe. Informational only. */
let clockOffsetMs = 0;
let quitHooksRegistered = false;

// Module-level timer handles so onSystemResume can rebuild them after a
// macOS App Nap freeze. NodeJS.Timeout in Electron's runtime.
let activityTimer: NodeJS.Timeout | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let onlineTimer: NodeJS.Timeout | null = null;

// Context for pattern detection
let currentAppStartTime = Date.now();
let lastInputTime = Date.now();
let windowChangeCount = 0;
let lastWindowTitle = '';
let lastAppName = '';
let lastCheckTime = Date.now();
let consecutiveIdleChecks = 0;

// Store config (simple JSON file)
let config: Config = {
  employeeId: TEAMTRACKER_CONFIG.defaults.employeeId,
  employeeName: TEAMTRACKER_CONFIG.defaults.employeeName,
  serverUrl: getServerUrl(),
  deviceToken: TEAMTRACKER_CONFIG.deviceToken || ''
};

export { getEffectiveServerUrl };

function syncRuntimeServerUrl(): void {
  setRuntimeServerUrl(config.serverUrl || getServerUrl());
}

export async function startTracking(): Promise<void> {
  console.log('🚀 Starting TeamTracker smart activity tracking...');

  // Load config
  loadConfig();
  syncRuntimeServerUrl();
  registerQuitHooks();

  // First-run activation: if no device token is saved, look for an
  // activation file in Downloads (dropped by the admin dashboard's
  // "Install on this device" flow) and redeem it for a device JWT.
  if (!config.deviceToken) {
    await activateFromDownloadsIfNeeded();
  }

  console.log(`Auth: token=${config.deviceToken ? 'present (' + config.deviceToken.length + ' chars)' : 'MISSING'}, server=${getEffectiveServerUrl()}`);

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

  // Wire up the periodic timers. They're held in module-level handles so
  // `onSystemResume` can clear and re-arm them after a sleep/wake cycle —
  // we've seen macOS App Nap freeze the JS event loop for days even with
  // powerSaveBlocker on, leaving setInterval handles alive but never
  // firing. Re-creating the intervals on wake guarantees we recover.
  startPeriodicTimers();

  // Periodic screenshot capture — controlled by org-level settings on the
  // server. Polls /api/organization to discover the current toggle and
  // interval, and uploads via /api/screenshots when enabled.
  startScreenshotService(
    () => config.deviceToken || '',
    () => ({
      appName: lastActivity?.appName,
      windowTitle: lastActivity?.windowTitle
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

async function checkActivity(): Promise<void> {
  try {
    const now = Date.now();
    const timeSinceLastCheck = (now - lastCheckTime) / 1000;
    lastCheckTime = now;

    // Detect tracker-suspended gaps (lunch / macOS App Nap / laptop lid).
    // The setInterval normally fires every 10s. Anything bigger than ~2
    // minutes means the process was paused while the user was away, and
    // powerMonitor.getSystemIdleTime() will read near-zero on the very
    // first check after wake (the user just moved the mouse), so the
    // normal AFK-cutoff branch below would never trigger for this gap.
    // Backfill ONE break_idle row covering the gap so the dashboard
    // reconciles with wall-clock time. The lastActivity pointer is set
    // to this row so the next normal sample's gap calc starts fresh.
    if (timeSinceLastCheck > 120) {
      const gapStartMs = now - Math.round(timeSinceLastCheck * 1000);
      const idleGap: TrackedActivity = {
        id: generateId(),
        timestamp: new Date(gapStartMs).toISOString(),
        appName: 'Idle',
        windowTitle: 'Away from desk (tracker suspended)',
        category: 'break_idle',
        categoryName: 'Break/Idle',
        productivityScore: 0,
        productivityLevel: 'idle',
        isSuspicious: false,
        suspiciousReason: undefined,
        isIdle: true,
        idleTimeSeconds: Math.round(timeSinceLastCheck),
        durationSeconds: Math.round(timeSinceLastCheck),
        hasInputActivity: false
      };
      activities.push(idleGap);
      enqueueActivity(idleGap);
      lastActivity = idleGap;
      console.log(`[${new Date().toLocaleTimeString('en-US', { hour12: false })}] 💤 GAP | Backfilled ${Math.round(timeSinceLastCheck / 60)}m of idle (tracker was suspended)`);
    }

    // Get system idle time (in milliseconds, convert to seconds)
    const idleTimeMs = powerMonitor.getSystemIdleTime();
    const idleTimeSec = Math.floor(idleTimeMs / 1000);

    // Detect input activity (no idle for last few seconds = active)
    const hasInputActivity = idleTimeSec < 3;
    if (hasInputActivity) {
      lastInputTime = now;
      consecutiveIdleChecks = 0;
    } else {
      consecutiveIdleChecks++;
    }

    // Get active window info (active-win on Mac/Win/X11; CLI fallbacks on Linux)
    let windowTitle = 'Unknown';
    let appName = 'Unknown';

    try {
      const winInfo = await getActiveWindow();
      if (!winInfo) {
        // Nothing readable this cycle (locked screen, Wayland without a
        // backend, brief focus transition). Skip rather than invent data.
        return;
      }
      windowTitle = winInfo.title || 'Untitled';
      appName = winInfo.owner?.name || 'Unknown';
    } catch (err) {
      console.error('Failed to get active window:', err);
      return;
    }

    // FIX: Skip system processes that shouldn't be tracked as employee activity
    const systemProcesses = [
      // macOS / Windows
      'loginwindow', 'window server', 'kernel', 'system', 'login window',
      'screen saver', 'screensaver', 'lockscreen', 'lock screen',
      // Linux display / session plumbing
      'gdm', 'gdm-session', 'lightdm', 'sddm', 'greeter',
      'gnome-shell', 'plasmashell', 'kwin_x11', 'kwin_wayland',
      'xorg', 'xwayland', 'wayland', 'pipewire', 'wireplumber',
      'xdg-desktop-portal', 'gsd-', 'gnome-session'
    ];
    const isSystemProcess = systemProcesses.some(proc => 
      appName.toLowerCase().includes(proc) || windowTitle.toLowerCase().includes(proc)
    );
    
    if (isSystemProcess) {
      // Don't record system processes at all - they're not employee activity
      return;
    }

    // FIX: Skip recording if user has been idle for more than 5 minutes
    // This prevents tracking background apps when user is away
    // Changed from 2 minutes to 5 minutes to avoid excessive idle entries
    if (idleTimeSec > 300) {
      // Only record an idle entry once per idle session (not every 10 seconds)
      if (!lastActivity || !lastActivity.isIdle || lastActivity.appName !== 'Idle') {
        const idleActivity: TrackedActivity = {
          id: generateId(),
          timestamp: new Date().toISOString(),
          appName: 'Idle',
          windowTitle: 'User away from computer',
          category: 'break_idle',
          categoryName: 'Break/Idle',
          productivityScore: 0,
          productivityLevel: 'idle',
          isSuspicious: false,
          suspiciousReason: undefined,
          isIdle: true,
          idleTimeSeconds: idleTimeSec,
          durationSeconds: Math.round(timeSinceLastCheck),
          hasInputActivity: false
        };
        
        activities.push(idleActivity);
        enqueueActivity(idleActivity);
        lastActivity = idleActivity;
        
        console.log(`[${new Date().toLocaleTimeString('en-US', { hour12: false })}] 💤 IDLE | User away for ${Math.round(idleTimeSec / 60)} minutes`);
      }
      return; // Skip the rest of the tracking
    }

    // Track window changes
    if (windowTitle !== lastWindowTitle) {
      windowChangeCount++;
      lastWindowTitle = windowTitle;
    }

    // Track app changes
    if (appName !== lastAppName) {
      currentAppStartTime = now;
      lastAppName = appName;
      windowChangeCount = 0;
    }

    // Calculate context for classification
    const durationInCurrentApp = (now - currentAppStartTime) / 60000;
    const timeSinceLastInput = (now - lastInputTime) / 60000;

    // Detect if video is likely playing
    const isVideoPlaying = (
      appName.toLowerCase().includes('youtube') ||
      appName.toLowerCase().includes('netflix') ||
      appName.toLowerCase().includes('hulu')
    ) && timeSinceLastInput > 2;

    // Classify the activity
    const classification = classifyActivity(appName, windowTitle, {
      durationMinutes: durationInCurrentApp,
      hasInputActivity,
      windowChangeCount,
      lastInputMinutesAgo: timeSinceLastInput,
      isVideoPlaying,
      isFullscreen: false
    });

    // Duration = time since the previous record's timestamp, capped at 90s.
    // The cap prevents double-counting with the idle backfill above (which
    // already covers gaps > 120s). Using the previous record's timestamp
    // (not its end) ensures no time is lost between rapid window switches.
    const lastTs = lastActivity
      ? new Date(lastActivity.timestamp).getTime()
      : now - timeSinceLastCheck * 1000;
    const gapSec = Math.min(Math.max(Math.round((now - lastTs) / 1000), 1), 90);

    // Create the activity record
    const activity: TrackedActivity = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      appName,
      windowTitle,
      category: classification.category,
      categoryName: classification.categoryName,
      productivityScore: classification.productivityScore,
      productivityLevel: classification.productivityLevel,
      isSuspicious: classification.isSuspicious,
      suspiciousReason: classification.suspiciousReason,
      isIdle: classification.isIdle,
      idleTimeSeconds: idleTimeSec,
      durationSeconds: gapSec,
      hasInputActivity
    };

    // Record activity if:
    // 1. Window/app has changed (user switched apps), OR
    // 2. It's been 60 seconds since last recorded activity (heartbeat), OR
    // 3. The activity is suspicious.
    //
    // The AFK cutoff above (idleTimeSec > 300) already drops snapshots when
    // the user is genuinely away for 5+ minutes. Between 0 and 5 minutes of
    // input inactivity the user is *present* — reading, watching a video, in
    // a meeting — and we MUST keep recording, otherwise an honest 60-minute
    // work session shows up as 15 minutes on the dashboard. (Previously the
    // record gate also AND'd on `idleTimeSec < 30`, which silently dropped
    // every snapshot during a reading session.)
    const windowChanged = !lastActivity ||
      lastActivity.appName !== activity.appName ||
      lastActivity.windowTitle !== activity.windowTitle;
    const significantTimePassed = !lastActivity ||
      (Date.now() - new Date(lastActivity.timestamp).getTime()) >= 60000;

    const shouldRecord = windowChanged || significantTimePassed || classification.isSuspicious;

    if (shouldRecord) {
      activities.push(activity);
      enqueueActivity(activity);
      lastActivity = activity;

      logActivity(activity);

      if (classification.isSuspicious) {
        console.warn(`⚠️  SUSPICIOUS: ${classification.suspiciousReason}`);
      }
    }

    if (activities.length > 2000) {
      activities.splice(0, activities.length - 1000);
    }

  } catch (err) {
    console.error('Error checking activity:', err);
  }
}

function logActivity(activity: TrackedActivity): void {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });

  let icon = '⚪';
  if (activity.productivityLevel === 'productive') icon = '🟢';
  else if (activity.productivityLevel === 'idle') icon = '💤';
  else if (activity.productivityLevel === 'unproductive') icon = '🔴';
  else if (activity.productivityLevel === 'neutral') icon = '🟡';

  const idleStr = activity.isIdle ? ' [IDLE]' : '';
  const suspiciousStr = activity.isSuspicious ? ' ⚠️' : '';

  console.log(
    `[${time}] ${icon} ${activity.appName}` +
    ` | ${activity.categoryName}` +
    ` | Score: ${activity.productivityScore}` +
    `${idleStr}${suspiciousStr}`
  );

  if (activity.windowTitle.length > 50) {
    console.log(`     "${activity.windowTitle.substring(0, 50)}..."`);
  } else {
    console.log(`     "${activity.windowTitle}"`);
  }

  if (activity.suspiciousReason) {
    console.log(`     ⚠️ ${activity.suspiciousReason}`);
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** FIFO enqueue with id-dedup, MAX_QUEUE cap, and debounced disk persist. */
function enqueueActivity(activity: TrackedActivity): void {
  if (activity.id && offlineQueue.some((a) => a.id === activity.id)) {
    return;
  }

  offlineQueue.push(activity);

  let droppedThisCall = 0;
  while (offlineQueue.length > MAX_QUEUE) {
    offlineQueue.shift();
    droppedThisCall++;
    queueDropCount++;
    queueOverflow = true;
  }
  if (droppedThisCall > 0) {
    console.warn(
      `[queue] overflow — dropped ${droppedThisCall} oldest (total drops: ${queueDropCount}, cap=${MAX_QUEUE})`
    );
  }

  scheduleSaveOfflineQueue();
}

function scheduleSaveOfflineQueue(): void {
  if (queueSaveTimer) return;
  queueSaveTimer = setTimeout(() => {
    queueSaveTimer = null;
    saveOfflineQueue();
  }, QUEUE_SAVE_DEBOUNCE_MS);
}

function flushOfflineQueueToDisk(): void {
  if (queueSaveTimer) {
    clearTimeout(queueSaveTimer);
    queueSaveTimer = null;
  }
  saveOfflineQueue();
}

function registerQuitHooks(): void {
  if (quitHooksRegistered) return;
  quitHooksRegistered = true;
  const flush = () => {
    try { flushOfflineQueueToDisk(); } catch { /* ignore */ }
  };
  app.on('before-quit', flush);
  app.on('will-quit', flush);
}

/**
 * Probe server clock. Stores clockOffsetMs for diagnostics via getStatus.
 * Do NOT rewrite activity timestamps automatically — client wall-clock
 * stamps stay as recorded; offset is informational for admins only.
 */
async function syncClockSkew(): Promise<void> {
  const serverUrl = getEffectiveServerUrl();
  const token = config.deviceToken;
  if (!token || !serverUrl) return;

  const clientTime = Date.now();
  try {
    const res = await fetch(`${serverUrl}/api/time?clientTime=${clientTime}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    const json: any = await res.json().catch(() => null);
    const offset = json?.data?.clockOffsetMs;
    if (typeof offset !== 'number' || !Number.isFinite(offset)) return;

    clockOffsetMs = offset;
    if (Math.abs(offset) > CLOCK_SKEW_WARN_MS) {
      console.warn(
        `[clock] skew |offset|=${Math.round(Math.abs(offset) / 1000)}s ` +
        `(${offset > 0 ? 'client behind server' : 'client ahead of server'}) — ` +
        `activity timestamps are NOT rewritten`
      );
    }
  } catch (err) {
    console.warn('[clock] time probe failed:', (err as Error).message);
  }
}

async function syncToServer(): Promise<void> {
  if (offlineQueue.length === 0) return;

  if (Date.now() < nextSyncAllowedAt) {
    return;
  }

  if (!isOnline) {
    console.log(`📴 Offline - ${offlineQueue.length} activities queued for later`);
    flushOfflineQueueToDisk();
    return;
  }

  // Process in batches of 50 to avoid payload too large (FIFO from front)
  const BATCH_SIZE = 50;
  let totalSynced = 0;
  let totalSuspicious = 0;

  while (offlineQueue.length > 0) {
    if (Date.now() < nextSyncAllowedAt) break;

    const batchSize = Math.min(BATCH_SIZE, offlineQueue.length);
    const batch = offlineQueue.splice(0, batchSize);

    try {
      const payload = {
        employeeId: config.employeeId,
        activities: batch.map(a => ({
          id: a.id,
          timestamp: a.timestamp,
          appName: a.appName,
          windowTitle: a.windowTitle,
          category: a.category,
          categoryName: a.categoryName,
          productivityScore: a.productivityScore,
          productivityLevel: a.productivityLevel,
          isSuspicious: a.isSuspicious,
          suspiciousReason: a.suspiciousReason,
          isIdle: a.isIdle,
          idleTimeSeconds: a.idleTimeSeconds,
          durationSeconds: a.durationSeconds,
          ...(config.activeProjectId ? { projectId: config.activeProjectId } : {}),
          ...(config.activeTaskId ? { taskId: config.activeTaskId } : {}),
        }))
      };

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.deviceToken) {
        headers['Authorization'] = `Bearer ${config.deviceToken}`;
      }
      console.log(`Sync: token=${config.deviceToken ? 'yes' : 'no'}, url=${getEffectiveServerUrl()}, authHeader=${headers['Authorization'] ? 'set' : 'MISSING'}`);

      const response = await fetch(`${getEffectiveServerUrl()}/api/activity`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const body = await response.text();
        console.log(`Sync response: ${response.status} ${response.statusText} - ${body}`);
      }

      if (response.ok) {
        const result: any = await response.json();
        totalSynced += batch.length;
        totalSuspicious += result.data?.suspiciousCount || 0;
        syncBackoffMs = SYNC_BACKOFF_INITIAL_MS;
        nextSyncAllowedAt = 0;
      } else if (response.status === 401) {
        // Revoked / inactive employee / expired legacy token — clear local auth
        // so the employee UI returns to setup (needs a new one-time setup token).
        console.error('Device access revoked or invalid. Please re-enroll with a new setup token.');
        offlineQueue.unshift(...batch);
        clearDeviceAuth('sync received HTTP 401');
        isOnline = false;
        break;
      } else if (response.status === 429) {
        offlineQueue.unshift(...batch);
        nextSyncAllowedAt = Date.now() + syncBackoffMs;
        console.warn(`[sync] rate limited — retry in ${syncBackoffMs}ms`);
        syncBackoffMs = Math.min(syncBackoffMs * 2, SYNC_BACKOFF_MAX_MS);
        break;
      } else if (response.status >= 400 && response.status < 500) {
        // Non-retryable client error — drop this batch (do not poison the queue)
        console.warn(
          `[sync] dropping ${batch.length} activities due to HTTP ${response.status} (non-retryable 4xx)`
        );
        flushOfflineQueueToDisk();
        // continue with remaining FIFO items
      } else {
        // 5xx / other — requeue and back off
        offlineQueue.unshift(...batch);
        nextSyncAllowedAt = Date.now() + syncBackoffMs;
        console.error(`[sync] failed (${response.status}) — retry in ${syncBackoffMs}ms`);
        syncBackoffMs = Math.min(syncBackoffMs * 2, SYNC_BACKOFF_MAX_MS);
        break;
      }
    } catch (err) {
      offlineQueue.unshift(...batch);
      isOnline = false;
      nextSyncAllowedAt = Date.now() + syncBackoffMs;
      console.error(`[sync] network error — retry in ${syncBackoffMs}ms:`, err);
      syncBackoffMs = Math.min(syncBackoffMs * 2, SYNC_BACKOFF_MAX_MS);
      flushOfflineQueueToDisk();
      break;
    }
  }

  if (totalSynced > 0) {
    console.log(`✓ Synced ${totalSynced} activities`);
    if (totalSuspicious > 0) {
      console.warn(`⚠️ Server flagged ${totalSuspicious} suspicious activities`);
    }
    lastSyncTime = Date.now();
    flushOfflineQueueToDisk();
  }
}

async function checkOnlineStatus(): Promise<void> {
  try {
    const response = await fetch(`${getEffectiveServerUrl()}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    const wasOffline = !isOnline;
    isOnline = response.ok;

    if (wasOffline && isOnline && offlineQueue.length > 0) {
      console.log('🌐 Back online - syncing queued activities...');
      syncBackoffMs = SYNC_BACKOFF_INITIAL_MS;
      nextSyncAllowedAt = 0;
      syncToServer();
    }
  } catch {
    isOnline = false;
  }
}

function loadConfig(): void {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      // Prefer safeStorage-encrypted token when available.
      if (saved.deviceTokenEnc && typeof saved.deviceTokenEnc === 'string') {
        try {
          if (safeStorage.isEncryptionAvailable()) {
            saved.deviceToken = safeStorage.decryptString(Buffer.from(saved.deviceTokenEnc, 'base64'));
          } else {
            console.warn('[config] encrypted token present but safeStorage unavailable');
          }
        } catch (err) {
          console.error('[config] failed to decrypt device token:', (err as Error).message);
        }
        delete saved.deviceTokenEnc;
      }
      // Never log token material from saved config.
      config = { ...config, ...saved };
      if (config.serverUrl) {
        config.serverUrl = config.serverUrl.replace(/\/+$/, '');
      }
      // Not enrolled yet: ignore a stale saved serverUrl from a previous
      // production/local session so `pnpm run dev` always defaults to localhost
      // and release builds default to production.
      if (!config.deviceToken) {
        config.serverUrl = getServerUrl();
      }
      syncRuntimeServerUrl();
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

/**
 * First-run activation: look for an `teamtracker-activate*.json` file in the
 * user's Downloads folder, redeem the setup token against /api/auth/enroll,
 * and persist the returned device JWT + employee info into config.json.
 *
 * The admin dashboard's "Install on this device" button drops this file so
 * that a non-technical admin can install the tracker on an employee's
 * laptop and have it auto-authenticate without copy-pasting tokens.
 *
 * Safe to call every startup — it only runs if `config.deviceToken` is
 * empty. Returns `true` if activation succeeded, `false` otherwise. Never
 * throws.
 */
async function activateFromDownloadsIfNeeded(): Promise<boolean> {
  // Already have a device token from env var or previous run — skip.
  if (config.deviceToken) return false;

  let downloadsDir: string;
  try {
    downloadsDir = app.getPath('downloads');
  } catch {
    return false; // No downloads path on this platform — bail out silently.
  }

  if (!fs.existsSync(downloadsDir)) return false;

  // Find all teamtracker-activate*.json files, pick the newest by mtime.
  let matches: { path: string; mtimeMs: number }[] = [];
  try {
    const entries = fs.readdirSync(downloadsDir);
    for (const name of entries) {
      if (!name.startsWith('teamtracker-activate') || !name.endsWith('.json')) continue;
      const full = path.join(downloadsDir, name);
      try {
        const stat = fs.statSync(full);
        if (stat.isFile()) matches.push({ path: full, mtimeMs: stat.mtimeMs });
      } catch { /* ignore unreadable entries */ }
    }
  } catch (err) {
    console.warn('[activate] could not scan Downloads:', (err as Error).message);
    return false;
  }

  if (matches.length === 0) return false;

  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const target = matches[0].path;

  let payload: { setupToken?: string; token?: string; serverUrl?: string } = {};
  try {
    payload = JSON.parse(fs.readFileSync(target, 'utf-8'));
  } catch (err) {
    console.error('[activate] failed to parse activation file:', (err as Error).message);
    tryDeleteFile(target);
    return false;
  }

  const setupToken = payload.setupToken || payload.token;
  const serverUrl = (payload.serverUrl || config.serverUrl || '').replace(/\/+$/, '');

  if (!setupToken || !serverUrl) {
    console.error('[activate] activation file missing setupToken or serverUrl');
    tryDeleteFile(target);
    return false;
  }

  console.log(`[activate] found activation file, enrolling against ${serverUrl}...`);

  try {
    const resp = await fetch(`${serverUrl}/api/auth/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken })
    });
    const data: any = await resp.json().catch(() => ({}));

    if (!resp.ok || !data?.success || !data?.data?.accessToken) {
      const reason = data?.error || `HTTP ${resp.status}`;
      console.error(`[activate] enrollment rejected: ${reason}`);
      tryDeleteFile(target); // Stale/invalid token — don't retry on every launch.
      return false;
    }

    // Success — persist everything.
    config.deviceToken = data.data.accessToken;
    config.employeeId = data.data.employeeId;
    config.employeeName = data.data.employeeName;
    config.serverUrl = serverUrl;
    syncRuntimeServerUrl();
    saveConfig();

    // Clean up ALL activation files so stale ones don't linger.
    for (const m of matches) tryDeleteFile(m.path);

    console.log(`[activate] ✓ activated as ${data.data.employeeName} (${data.data.employeeId})`);
    void syncClockSkew();
    return true;
  } catch (err) {
    console.error('[activate] network error during enrollment:', (err as Error).message);
    // Leave the file in place — this is likely a transient offline state,
    // user may be trying to install without internet. Next launch will retry.
    return false;
  }
}

function tryDeleteFile(p: string): void {
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}

function saveConfig(): void {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    const toSave: Record<string, unknown> = {
      employeeId: config.employeeId,
      employeeName: config.employeeName,
      serverUrl: config.serverUrl,
    };
    if (config.activeProjectId) toSave.activeProjectId = config.activeProjectId;
    if (config.activeTaskId) toSave.activeTaskId = config.activeTaskId;

    if (config.deviceToken) {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          toSave.deviceTokenEnc = safeStorage.encryptString(config.deviceToken).toString('base64');
        } else {
          // Linux without keyring / encryption unavailable — plaintext fallback.
          toSave.deviceToken = config.deviceToken;
        }
      } catch {
        toSave.deviceToken = config.deviceToken;
      }
    }
    // When signed out, omit token fields so a previous deviceTokenEnc is not
    // reloaded on next launch.

    fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2));
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

function loadOfflineQueue(): void {
  try {
    const queuePath = path.join(app.getPath('userData'), 'offline-queue.json');
    if (fs.existsSync(queuePath)) {
      const data = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      if (Array.isArray(data)) {
        const seen = new Set<string>();
        for (const item of data) {
          if (item?.id && seen.has(item.id)) continue;
          if (item?.id) seen.add(item.id);
          offlineQueue.push(item);
        }
        while (offlineQueue.length > MAX_QUEUE) {
          offlineQueue.shift();
          queueDropCount++;
          queueOverflow = true;
        }
        console.log(`📦 Loaded ${offlineQueue.length} queued activities from disk`);
        if (queueOverflow) {
          console.warn(`[queue] loaded queue was over cap — overflow flag set (drops: ${queueDropCount})`);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load offline queue:', err);
  }
}

function saveOfflineQueue(): void {
  try {
    const queuePath = path.join(app.getPath('userData'), 'offline-queue.json');
    fs.writeFileSync(queuePath, JSON.stringify(offlineQueue, null, 2));
  } catch (err) {
    console.error('Failed to save offline queue:', err);
  }
}

export async function enrollWithSetupToken(
  setupToken: string,
  serverUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const url = (serverUrl || config.serverUrl || getServerUrl()).replace(/\/+$/, '');
  if (!setupToken?.trim()) {
    return { success: false, error: 'Setup token is required' };
  }
  if (!url) {
    return { success: false, error: 'Server URL is required' };
  }

  try {
    const resp = await fetch(`${url}/api/auth/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken: setupToken.trim() })
    });
    const data: any = await resp.json().catch(() => ({}));

    if (!resp.ok || !data?.success || !data?.data?.accessToken) {
      return { success: false, error: data?.error || `Enrollment failed (HTTP ${resp.status})` };
    }

    config.deviceToken = data.data.accessToken;
    config.employeeId = data.data.employeeId;
    config.employeeName = data.data.employeeName;
    config.serverUrl = url;
    syncRuntimeServerUrl();
    saveConfig();

    console.log(`[enroll] ✓ connected as ${data.data.employeeName} (${data.data.employeeId})`);
    isOnline = true;
    // Re-open presence WS after sign-out (or first enroll while app already running).
    startPresenceClient();
    void syncClockSkew();
    // Flush anything queued while offline / before auth.
    Promise.resolve().then(() => syncToServer()).catch(() => { /* ignore */ });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message || 'Network error' };
  }
}

export function isEnrolled(): boolean {
  return !!config.deviceToken;
}

/**
 * Sign out this device: drop the device JWT and employee identity so the
 * employee can re-enroll with a new setup token. Resets serverUrl to the
 * build/env default (localhost in dev, production in release builds).
 */
export function logoutDevice(): { success: boolean } {
  clearDeviceAuth('user signed out');
  return { success: true };
}

function startPresenceClient(): void {
  startRemoteCommandClient(
    () => config.deviceToken || '',
    () => ({
      appName: lastActivity?.appName,
      windowTitle: lastActivity?.windowTitle,
      employeeName: config.employeeName,
    })
  );
}

function clearDeviceAuth(reason: string): void {
  if (!config.deviceToken && !config.employeeId) return;
  console.log(`[auth] clearing device credentials (${reason})`);
  // Close presence WS first so admin shows offline immediately on sign-out
  // (otherwise the authenticated socket stays open until the app quits).
  stopRemoteCommandClient();
  config.deviceToken = '';
  config.employeeId = TEAMTRACKER_CONFIG.defaults.employeeId;
  config.employeeName = TEAMTRACKER_CONFIG.defaults.employeeName;
  config.activeProjectId = undefined;
  config.activeTaskId = undefined;
  // Reset to build/env default so local dev doesn't keep a production URL
  // (and release builds don't keep a leftover localhost URL).
  config.serverUrl = getServerUrl();
  syncRuntimeServerUrl();
  saveConfig();

  // Queued rows belong to the previous identity — drop them to avoid
  // uploading under a different employee after re-enroll.
  offlineQueue.length = 0;
  queueOverflow = false;
  queueDropCount = 0;
  saveOfflineQueue();
}

export function setupIpcHandlers(): void {
  ipcMain.handle('tracker:getStatus', () => {
    const showPrivacy = getShowPrivacyBlocksToEmployees();
    const privacyPatterns = showPrivacy
      ? [...new Set(getCapturePrivacyBlocks().map(b => b.appPattern).filter(Boolean))]
      : [];
    return {
      isOnline,
      activitiesCount: activities.length,
      queuedCount: offlineQueue.length,
      queueOverflow,
      queueDropCount,
      clockOffsetMs,
      lastActivity,
      showPrivacyBlocksToEmployees: showPrivacy,
      privacyUrlMode: getPrivacyUrlMode(),
      privacyProtectedSites: privacyPatterns,
      config: {
        ...config,
        deviceToken: config.deviceToken ? '***' : '',
        // Never expose server URL to the employee UI status surface.
        serverUrl: undefined,
        activeProjectId: config.activeProjectId,
        activeTaskId: config.activeTaskId,
      },
      // Setup form only — prefilled default, not shown after enroll.
      defaultServerUrl: config.serverUrl || getServerUrl(),
    };
  });

  ipcMain.handle('tracker:enroll', async (_, setupToken: string, serverUrl?: string) => {
    return enrollWithSetupToken(setupToken, serverUrl);
  });

  ipcMain.handle('tracker:logout', () => logoutDevice());

  ipcMain.handle('tracker:getStats', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayActivities = activities.filter(a =>
      new Date(a.timestamp) >= today
    ).map(a => ({
      category: a.category,
      duration: a.durationSeconds,
      isIdle: a.isIdle,
      isSuspicious: a.isSuspicious,
      appName: a.appName,
      windowTitle: a.windowTitle
    }));

    return generateDailySummary(config.employeeId, todayActivities);
  });

  ipcMain.handle('tracker:getRecentActivities', () => {
    return activities.slice(-50).reverse();
  });

  ipcMain.handle('tracker:updateConfig', (_, newConfig: Partial<Config>) => {
    // Never accept/log raw token dumps from renderer beyond assignment.
    const { deviceToken: _ignored, ...safe } = newConfig as Partial<Config> & { deviceToken?: string };
    void _ignored;
    config = { ...config, ...safe };
    // Allow explicit project/task clear via nullish empty string
    if ('activeProjectId' in newConfig) {
      config.activeProjectId = newConfig.activeProjectId || undefined;
    }
    if ('activeTaskId' in newConfig) {
      config.activeTaskId = newConfig.activeTaskId || undefined;
    }
    if (config.serverUrl) {
      config.serverUrl = String(config.serverUrl).replace(/\/+$/, '');
    }
    syncRuntimeServerUrl();
    saveConfig();
    return {
      ...config,
      deviceToken: config.deviceToken ? '***' : '',
    };
  });

  ipcMain.handle('tracker:setActiveProjectTask', (_, projectId?: string, taskId?: string) => {
    config.activeProjectId = projectId || undefined;
    config.activeTaskId = taskId || undefined;
    saveConfig();
    return { activeProjectId: config.activeProjectId, activeTaskId: config.activeTaskId };
  });
}

export function getTrackingStatus() {
  return {
    activitiesCount: activities.length,
    queuedCount: offlineQueue.length,
    queueOverflow,
    queueDropCount,
    clockOffsetMs,
    isOnline,
    lastSync: lastSyncTime ? new Date(lastSyncTime).toISOString() : null,
    lastActivity,
    config: {
      ...config,
      deviceToken: config.deviceToken ? '***' : '',
    }
  };
}

// Watchdog state — when did checkActivity last actually run?
let lastCheckActivityRun = Date.now();
let watchdogTimer: NodeJS.Timeout | null = null;

/**
 * (Re)create the periodic check/sync timers. Called once at startup and
 * again from onSystemResume() / the watchdog after a freeze, because
 * macOS App Nap can freeze the JS event loop for hours or days even with
 * powerSaveBlocker + a hidden BrowserWindow — leaving setInterval handles
 * alive but inert. Clearing and recreating guarantees fresh timers.
 */
function startPeriodicTimers(): void {
  if (activityTimer) clearInterval(activityTimer);
  if (syncTimer) clearInterval(syncTimer);
  if (onlineTimer) clearInterval(onlineTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);

  // Wrap checkActivity so each successful run updates the watchdog's
  // "I am alive" timestamp. The watchdog uses this to detect when the
  // timers have stopped firing.
  const tickedCheckActivity = async () => {
    lastCheckActivityRun = Date.now();
    try { await checkActivity(); } catch (e) { console.error('[tracker] checkActivity threw:', (e as Error).message); }
  };

  activityTimer = setInterval(tickedCheckActivity, 10000);
  syncTimer = setInterval(syncToServer, 60000);
  onlineTimer = setInterval(checkOnlineStatus, 30000);

  // Watchdog: every 30s look at the wall-clock delta since checkActivity
  // last ran. If more than 3 minutes have passed (i.e. 18 missed ticks),
  // assume the event loop was frozen and recovered, and rebuild the
  // timers from scratch. We also fire one immediate check + sync so the
  // gap-backfill in checkActivity records the freeze duration.
  //
  // This is belt-and-suspenders alongside the hidden BrowserWindow and
  // powerMonitor.on('resume'). If those defeat App Nap as expected,
  // this watchdog never trips. If they don't, the user-visible gap is
  // capped at ~3 minutes instead of days.
  lastCheckActivityRun = Date.now();
  watchdogTimer = setInterval(() => {
    const gapMs = Date.now() - lastCheckActivityRun;
    if (gapMs > 3 * 60 * 1000) {
      console.warn(`[watchdog] checkActivity hasn't run in ${Math.round(gapMs / 1000)}s — rebuilding timers`);
      // Note: calling startPeriodicTimers() from inside its own timer
      // is safe — clearInterval on watchdogTimer below cancels OUR
      // timer before the recursive call recreates a new one.
      startPeriodicTimers();
      Promise.resolve().then(() => checkActivity()).catch(() => { /* swallow */ });
      Promise.resolve().then(() => syncToServer()).catch(() => { /* swallow */ });
    }
  }, 30000);
}

/**
 * Called by main.ts on `powerMonitor.on('resume')` — fired natively by
 * Electron when the system wakes from sleep. We force an immediate
 * activity check + sync (so the gap-backfill row goes in promptly) and
 * rebuild the periodic timers so frozen ones can never silently persist
 * after the wake. Safe to call multiple times.
 */
export function onSystemResume(): void {
  console.log('[power] system resumed — re-arming tracker timers');
  // Reset the "last check" clock to NOW so the gap detector inside
  // checkActivity computes the correct sleep gap from this point forward.
  // (checkActivity itself measures the gap before resetting, so we don't
  // need to reset it here — let the first post-resume tick do that.)
  startPeriodicTimers();
  // Fire one immediate tick + sync in case the next setInterval boundary
  // is up to 10s/60s away.
  Promise.resolve().then(() => checkActivity()).catch(() => { /* swallow */ });
  Promise.resolve().then(() => syncToServer()).catch(() => { /* swallow */ });
  Promise.resolve().then(() => checkOnlineStatus()).catch(() => { /* swallow */ });
}
