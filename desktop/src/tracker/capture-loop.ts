/**
 * Activity capture loop — polls the active window every 10 s, classifies it,
 * enqueues the result, and manages the watchdog/periodic timers.
 *
 * Also owns the live-presence WebSocket client startup (startPresenceClient).
 */
import { powerMonitor } from 'electron';
import { config, trackerState } from './state.js';
import { classifyActivity } from '../classifier.js';
import { enqueueActivity } from './offline-queue.js';
import { syncToServer, checkOnlineStatus } from './sync.js';
import { getActiveWindow } from '../active-window.js';
import { startRemoteCommandClient } from '../remote.js';
import type { TrackedActivity } from './types.js';

// ── Capture-loop-local state (not shared across modules) ──────────────────────

let currentAppStartTime = Date.now();
let lastInputTime = Date.now();
let windowChangeCount = 0;
let lastWindowTitle = '';
let lastAppName = '';
let lastCheckTime = Date.now();
let consecutiveIdleChecks = 0;

// Module-level timer handles so onSystemResume can rebuild them after a
// macOS App Nap freeze.
let activityTimer: NodeJS.Timeout | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let onlineTimer: NodeJS.Timeout | null = null;

// Watchdog — tracks when checkActivity last successfully ran.
let lastCheckActivityRun = Date.now();
let watchdogTimer: NodeJS.Timeout | null = null;

// ── Presence client ───────────────────────────────────────────────────────────

/** (Re-)open the live presence + on-demand screenshot WebSocket. */
export function startPresenceClient(): void {
  startRemoteCommandClient(
    () => config.deviceToken || '',
    () => ({
      appName: trackerState.lastActivity?.appName,
      windowTitle: trackerState.lastActivity?.windowTitle,
      employeeName: config.employeeName,
    })
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
    // reconciles with wall-clock time.
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
      trackerState.activities.push(idleGap);
      enqueueActivity(idleGap);
      trackerState.lastActivity = idleGap;
      console.log(
        `[${new Date().toLocaleTimeString('en-US', { hour12: false })}] ` +
        `💤 GAP | Backfilled ${Math.round(timeSinceLastCheck / 60)}m of idle ` +
        `(tracker was suspended)`
      );
    }

    // Get system idle time (in milliseconds, convert to seconds).
    const idleTimeMs = powerMonitor.getSystemIdleTime();
    const idleTimeSec = Math.floor(idleTimeMs / 1000);

    // Detect input activity (no idle for last few seconds = active).
    const hasInputActivity = idleTimeSec < 3;
    if (hasInputActivity) {
      lastInputTime = now;
      consecutiveIdleChecks = 0;
    } else {
      consecutiveIdleChecks++;
    }

    // Get active window info (active-win on Mac/Win/X11; CLI fallbacks on Linux).
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

    // Skip system processes that shouldn't be tracked as employee activity.
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
      return;
    }

    // Skip recording if user has been idle for more than 5 minutes.
    // Only record an idle entry once per idle session.
    if (idleTimeSec > 300) {
      if (
        !trackerState.lastActivity ||
        !trackerState.lastActivity.isIdle ||
        trackerState.lastActivity.appName !== 'Idle'
      ) {
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

        trackerState.activities.push(idleActivity);
        enqueueActivity(idleActivity);
        trackerState.lastActivity = idleActivity;

        console.log(
          `[${new Date().toLocaleTimeString('en-US', { hour12: false })}] ` +
          `💤 IDLE | User away for ${Math.round(idleTimeSec / 60)} minutes`
        );
      }
      return;
    }

    // Track window / app changes.
    if (windowTitle !== lastWindowTitle) {
      windowChangeCount++;
      lastWindowTitle = windowTitle;
    }

    if (appName !== lastAppName) {
      currentAppStartTime = now;
      lastAppName = appName;
      windowChangeCount = 0;
    }

    const durationInCurrentApp = (now - currentAppStartTime) / 60000;
    const timeSinceLastInput = (now - lastInputTime) / 60000;

    const isVideoPlaying = (
      appName.toLowerCase().includes('youtube') ||
      appName.toLowerCase().includes('netflix') ||
      appName.toLowerCase().includes('hulu')
    ) && timeSinceLastInput > 2;

    const classification = classifyActivity(appName, windowTitle, {
      durationMinutes: durationInCurrentApp,
      hasInputActivity,
      windowChangeCount,
      lastInputMinutesAgo: timeSinceLastInput,
      isVideoPlaying,
      isFullscreen: false
    });

    // Duration = time since the previous record's timestamp, capped at 90s.
    // The cap prevents double-counting with the idle backfill above.
    const lastTs = trackerState.lastActivity
      ? new Date(trackerState.lastActivity.timestamp).getTime()
      : now - timeSinceLastCheck * 1000;
    const gapSec = Math.min(Math.max(Math.round((now - lastTs) / 1000), 1), 90);

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

    // Record activity if: window/app changed, 60s heartbeat, or suspicious.
    const windowChanged =
      !trackerState.lastActivity ||
      trackerState.lastActivity.appName !== activity.appName ||
      trackerState.lastActivity.windowTitle !== activity.windowTitle;
    const significantTimePassed =
      !trackerState.lastActivity ||
      (Date.now() - new Date(trackerState.lastActivity.timestamp).getTime()) >= 60000;

    const shouldRecord = windowChanged || significantTimePassed || classification.isSuspicious;

    if (shouldRecord) {
      trackerState.activities.push(activity);
      enqueueActivity(activity);
      trackerState.lastActivity = activity;

      logActivity(activity);

      if (classification.isSuspicious) {
        console.warn(`⚠️  SUSPICIOUS: ${classification.suspiciousReason}`);
      }
    }

    if (trackerState.activities.length > 2000) {
      trackerState.activities.splice(0, trackerState.activities.length - 1000);
    }

  } catch (err) {
    console.error('Error checking activity:', err);
  }
}

// ── Timer management ──────────────────────────────────────────────────────────

/**
 * (Re)create the periodic check/sync timers. Called once at startup and
 * again from onSystemResume() / the watchdog after a freeze, because
 * macOS App Nap can freeze the JS event loop for hours or days even with
 * powerSaveBlocker + a hidden BrowserWindow — leaving setInterval handles
 * alive but inert. Clearing and recreating guarantees fresh timers.
 */
export function startPeriodicTimers(): void {
  if (activityTimer) clearInterval(activityTimer);
  if (syncTimer) clearInterval(syncTimer);
  if (onlineTimer) clearInterval(onlineTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);

  // Wrap checkActivity so each successful run updates the watchdog timestamp.
  const tickedCheckActivity = async () => {
    lastCheckActivityRun = Date.now();
    try {
      await checkActivity();
    } catch (e) {
      console.error('[tracker] checkActivity threw:', (e as Error).message);
    }
  };

  activityTimer = setInterval(tickedCheckActivity, 10000);
  syncTimer = setInterval(syncToServer, 60000);
  onlineTimer = setInterval(checkOnlineStatus, 30000);

  // Watchdog: every 30s look at the wall-clock delta since checkActivity
  // last ran. If more than 3 minutes have passed (18 missed ticks), assume
  // the event loop was frozen and recovered, and rebuild the timers from
  // scratch. Belt-and-suspenders alongside powerMonitor.on('resume').
  lastCheckActivityRun = Date.now();
  watchdogTimer = setInterval(() => {
    const gapMs = Date.now() - lastCheckActivityRun;
    if (gapMs > 3 * 60 * 1000) {
      console.warn(
        `[watchdog] checkActivity hasn't run in ${Math.round(gapMs / 1000)}s — rebuilding timers`
      );
      // Safe to call recursively — clearInterval(watchdogTimer) above cancels
      // the current timer before the recursive call creates a new one.
      startPeriodicTimers();
      Promise.resolve().then(() => checkActivity()).catch(() => { /* swallow */ });
      Promise.resolve().then(() => syncToServer()).catch(() => { /* swallow */ });
    }
  }, 30000);
}

/**
 * Called by main.ts on `powerMonitor.on('resume')` and
 * `powerMonitor.on('unlock-screen')`. Forces an immediate activity check +
 * sync (so the gap-backfill row goes in promptly) and rebuilds the periodic
 * timers so frozen ones can never silently persist after the wake.
 */
export function onSystemResume(): void {
  console.log('[power] system resumed — re-arming tracker timers');
  startPeriodicTimers();
  // Fire one immediate tick + sync in case the next setInterval boundary
  // is up to 10s / 60s away.
  Promise.resolve().then(() => checkActivity()).catch(() => { /* swallow */ });
  Promise.resolve().then(() => syncToServer()).catch(() => { /* swallow */ });
  Promise.resolve().then(() => checkOnlineStatus()).catch(() => { /* swallow */ });
}
