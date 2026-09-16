import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, powerSaveBlocker, powerMonitor } from 'electron';
import Store from 'electron-store';
import * as path from 'path';
import { startTracking, getTrackingStatus, setupIpcHandlers, onSystemResume, isEnrolled, logoutDevice } from './tracker.js';

function assetPath(...parts: string[]): string {
  return path.join(app.getAppPath(), 'dist', ...parts);
}
import { TEAMTRACKER_CONFIG, getServerUrl } from './config.js';

const store = new Store({
  defaults: {
    employeeId: TEAMTRACKER_CONFIG.defaults.employeeId,
    employeeName: TEAMTRACKER_CONFIG.defaults.employeeName,
    serverUrl: getServerUrl()
  }
});

// Default: normal desktop app (Dock / taskbar / tray visible).
// Stealth mode is opt-in via env var or store flag. When on:
//   - no tray icon is created
//   - dock icon is hidden on macOS (app.dock.hide)
//   - employee window is not shown at startup
//   - the tracker still runs and uploads as normal
const STEALTH_MODE =
  process.env.TEAMTRACKER_STEALTH === '1' ||
  process.env.TEAMTRACKER_STEALTH === 'true' ||
  store.get('stealthMode') === true;

let tray: Tray | null = null;
let isQuitting = false;
// Hold a reference so the powerSaveBlocker isn't garbage-collected.
// Without this, macOS App Nap throttles background timers (setInterval)
// when the app has no visible window — sync/screenshot loops freeze
// indefinitely.
let powerSaveBlockerId: number | null = null;
// Hold a reference to a hidden BrowserWindow. macOS App Nap will fully
// suspend the JS event loop for headless Electron apps even with
// powerSaveBlocker on — we've observed multiple 7-12 day silent gaps in
// production. Creating ANY BrowserWindow (even invisible) flips the app
// from "headless" to "active GUI app" in macOS's bookkeeping and keeps
// the event loop running. `backgroundThrottling: false` additionally
// disables Chromium's own throttling of background renderers.
let keepAliveWindow: BrowserWindow | null = null;
let employeeWindow: BrowserWindow | null = null;

app.whenReady().then(async () => {
  // Block App Nap and idle suspension on macOS. Safe no-op on Windows/Linux.
  // 'prevent-app-suspension' lets the screen sleep but keeps the app's
  // timers running, which is exactly what a background tracker needs.
  try {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } catch (e) {
    console.warn('[main] powerSaveBlocker failed to start:', (e as Error).message);
  }

  if (!STEALTH_MODE) {
    console.log('╔════════════════════════════════════════╗');
    console.log('║     TeamTracker Auto-Tracker v2.1        ║');
    console.log('║  Automatic Activity Tracking System    ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
  }

  // Normal mode: show in macOS Dock like any other open app.
  // Stealth: hide Dock; Windows/Linux rely on no tray + skipTaskbar keep-alive.
  if (process.platform === 'darwin' && app.dock) {
    try {
      if (STEALTH_MODE) app.dock.hide();
      else app.dock.show();
    } catch { /* ignore */ }
  }

  if (!STEALTH_MODE) {
    createTray();
  }

  // Create the invisible keep-alive window BEFORE startTracking so the
  // first setInterval calls register against a non-throttled event loop.
  createKeepAliveWindow();

  setupIpcHandlers();
  await startTracking();

  if (!STEALTH_MODE) {
    createEmployeeWindow();
  }

  // macOS App Nap can freeze the JS event loop for hours or days after a
  // sleep/wake cycle even with powerSaveBlocker on, leaving setInterval
  // handles alive but inert (we observed an 8-day silent gap in v1.0.1).
  // powerMonitor events fire natively from the Electron side and are not
  // subject to App Nap, so we use them to re-arm the JS timers. Safe to
  // hook on Windows/Linux too — these events fire on lid open / display
  // wake / hibernate-resume and are no-ops if the timers were already
  // healthy.
  powerMonitor.on('resume', () => {
    try { onSystemResume(); } catch (e) { console.error('[power] onSystemResume failed:', e); }
  });
  powerMonitor.on('unlock-screen', () => {
    try { onSystemResume(); } catch (e) { console.error('[power] onSystemResume failed:', e); }
  });
  // Log suspends so the next morning we can correlate gaps with sleeps.
  powerMonitor.on('suspend', () => {
    console.log('[power] system suspending');
  });

  if (!STEALTH_MODE) {
    console.log('');
    console.log('✓ Tracker running in background');
    console.log('✓ Detecting active windows every 10 seconds');
    console.log('✓ Syncing to admin dashboard every 60 seconds');
  }
});

/**
 * Create a 1x1 invisible BrowserWindow that exists purely to defeat
 * macOS App Nap and Chromium's background-renderer throttling. The
 * window has no UI — it's positioned off-screen, transparent, frameless,
 * with no shadow. The user never sees it. But because the app now has a
 * BrowserWindow, macOS considers it an active GUI app and keeps its JS
 * event loop running indefinitely. backgroundThrottling: false
 * additionally tells Chromium not to throttle this window's timers.
 *
 * Without this, setInterval handles in the main process freeze for days
 * at a time on lid-close, App Nap, or low-power states — leaving the
 * tracker silently dead. Observed gaps of 8d and 12d in production.
 */
function createKeepAliveWindow(): void {
  try {
    keepAliveWindow = new BrowserWindow({
      width: 1,
      height: 1,
      x: -100,
      y: -100,
      show: false,
      skipTaskbar: true,
      transparent: true,
      frame: false,
      hasShadow: false,
      focusable: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'TeamTracker',
      webPreferences: {
        backgroundThrottling: false,
        offscreen: false,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    // Load a trivial in-memory page. The contents don't matter — we
    // just need the window to exist and have a live renderer process.
    keepAliveWindow.loadURL('data:text/html;charset=utf-8,<title>TeamTracker</title>');
    // Make sure it never accidentally becomes visible.
    keepAliveWindow.on('show', () => { try { keepAliveWindow?.hide(); } catch { /* ignore */ } });
    keepAliveWindow.on('closed', () => { keepAliveWindow = null; });
    console.log('[keep-alive] hidden window created to defeat App Nap');
  } catch (e) {
    console.error('[keep-alive] failed to create hidden window:', (e as Error).message);
  }
}

function createEmployeeWindow(): void {
  if (employeeWindow && !employeeWindow.isDestroyed()) {
    employeeWindow.show();
    employeeWindow.focus();
    return;
  }

  employeeWindow = new BrowserWindow({
    width: 400,
    height: 480,
    minWidth: 360,
    minHeight: 400,
    title: 'TeamTracker',
    show: false,
    resizable: false,
    skipTaskbar: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: assetPath('preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  employeeWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  employeeWindow.webContents.on('will-navigate', (event, url) => {
    // Local UI only — block any navigation away from the packaged file:// page.
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  employeeWindow.loadFile(assetPath('ui', 'index.html'));
  employeeWindow.once('ready-to-show', () => {
    employeeWindow?.show();
    employeeWindow?.focus();
  });
  // Closing the window should not quit the tracker. Keep the app in the
  // Dock (macOS) / tray; on Windows/Linux minimize so it stays on the taskbar.
  employeeWindow.on('close', (event) => {
    if (isQuitting || STEALTH_MODE) return;
    event.preventDefault();
    if (process.platform === 'darwin') {
      employeeWindow?.hide();
    } else {
      employeeWindow?.minimize();
    }
  });
  employeeWindow.on('closed', () => {
    employeeWindow = null;
  });
}

function createTray(): void {
  // Simple colored square icon (green for active)
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABWSURBVDiNY2RgYPgPBAzUAIY1QLwKiP9D+Tg1oCkY1gDxw/8pDIOJ41SDa4ZRM7E0w2wYdTMxDcE0o+smhGFG3UxsM8xuRt1MbDOsbsI1jFE3E9sMtxsZ1QAAtg4Xy4eo4TkAAAAASUVORK5CYII=');

  tray = new Tray(icon);
  tray.setToolTip('TeamTracker - Activity Tracker');

  tray.on('click', () => createEmployeeWindow());
  updateTrayMenu();

  // Update menu every 5 seconds to show current status
  setInterval(updateTrayMenu, 5000);
}

function updateTrayMenu(): void {
  if (!tray) return;

  const status = getTrackingStatus();
  const enrolled = isEnrolled();
  const displayName = status.config.employeeName || status.config.employeeId || 'Employee';

  const items: Electron.MenuItemConstructorOptions[] = [
    { label: 'TeamTracker', enabled: false },
    { type: 'separator' },
    { label: enrolled ? `Signed in as ${displayName}` : 'Not signed in', enabled: false },
    { label: `Status: ${status.isOnline ? 'Online' : 'Offline'}`, enabled: false },
    { type: 'separator' },
    { label: enrolled ? 'Show Window' : 'Setup…', click: () => createEmployeeWindow() },
  ];

  if (enrolled) {
    items.push({
      label: 'Sign Out',
      click: () => {
        logoutDevice();
        createEmployeeWindow();
        updateTrayMenu();
      },
    });
  }

  items.push(
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  );

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('activate', () => {
  // macOS Dock click / Cmd+Tab back to the app.
  if (!STEALTH_MODE) createEmployeeWindow();
});

app.on('window-all-closed', () => {
  // Keep the tracker running when windows are closed/hidden.
  // Quit only from the tray menu (or Cmd+Q / app.quit()).
});
