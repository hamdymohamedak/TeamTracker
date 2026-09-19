// TeamTracker Admin — Electron shell that embeds a local admin server (LAN office)
// or can point at a remote dashboard URL.

import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  shell,
  dialog,
  clipboard,
} from 'electron';
import Store from 'electron-store';
import * as path from 'path';
import {
  shouldEmbedLocalServer,
  startLocalServer,
  stopLocalServer,
  restartLocalServer,
  LOCAL_ADMIN_URL,
  isLocalServerRunning,
} from './local-server.js';

const DEFAULT_REMOTE_URL =
  process.env.TEAMTRACKER_ADMIN_URL ||
  'http://localhost:3001';

const store = new Store<{
  adminUrl: string;
  /** When true (default when packaged), spawn embedded server. */
  useEmbeddedServer: boolean;
}>({
  defaults: {
    adminUrl: DEFAULT_REMOTE_URL,
    useEmbeddedServer: true,
  },
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let embedMode = false;

function getAdminUrl(): string {
  if (embedMode) return LOCAL_ADMIN_URL;
  const fromEnv = process.env.TEAMTRACKER_ADMIN_URL;
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) return fromEnv.replace(/\/+$/, '');
  const stored = String(store.get('adminUrl') || DEFAULT_REMOTE_URL).trim();
  return (stored || DEFAULT_REMOTE_URL).replace(/\/+$/, '');
}

function asset(...parts: string[]): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', ...parts);
  }
  return path.join(app.getAppPath(), 'assets', ...parts);
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'TeamTracker Admin',
    icon: (() => {
      const img = nativeImage.createFromPath(asset('icon.png'));
      return img.isEmpty() ? undefined : img;
    })(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const url = getAdminUrl();
  void mainWindow.loadURL(url);

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const allowedOrigin = new URL(getAdminUrl()).origin;
      if (new URL(targetUrl).origin !== allowedOrigin) {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function openWebsiteInBrowser(): Promise<void> {
  const url = getAdminUrl();
  await shell.openExternal(url);
}

async function changeAdminUrl(): Promise<void> {
  const current = getAdminUrl();
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: [
      'Use embedded local server',
      'Use localhost:3001 (external)',
      'Copy current URL',
      'Cancel',
    ],
    defaultId: 0,
    cancelId: 3,
    title: 'Admin dashboard URL',
    message: 'Choose how this app connects to the dashboard',
    detail:
      `Current: ${current}\n` +
      `Mode: ${embedMode ? 'embedded local office' : 'remote / external URL'}\n\n` +
      'Embedded mode runs TeamTracker on this computer and advertises it on your LAN.\n' +
      'Set TEAMTRACKER_ADMIN_URL to force a remote cloud dashboard.',
  });

  if (result.response === 3) return;

  if (result.response === 2) {
    clipboard.writeText(current);
    return;
  }

  if (result.response === 0) {
    store.set('useEmbeddedServer', true);
    try {
      await startLocalServer();
      embedMode = true;
    } catch (err) {
      await dialog.showErrorBox('Local server failed', String(err));
      return;
    }
  } else if (result.response === 1) {
    store.set('useEmbeddedServer', false);
    stopLocalServer();
    embedMode = false;
    store.set('adminUrl', 'http://localhost:3001');
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(getAdminUrl());
  }
  createTray();
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Open Website in Browser',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => { void openWebsiteInBrowser(); },
        },
        {
          label: 'Change Dashboard Mode…',
          click: () => { void changeAdminUrl(); },
        },
        {
          label: 'Restart Local Server',
          enabled: embedMode,
          click: async () => {
            try {
              await restartLocalServer();
              if (mainWindow && !mainWindow.isDestroyed()) {
                void mainWindow.loadURL(LOCAL_ADMIN_URL);
              }
            } catch (err) {
              await dialog.showErrorBox('Restart failed', String(err));
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Dashboard',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
          },
        },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Show Dashboard',
          click: () => createWindow(),
        },
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray(): void {
  if (tray) {
    try {
      tray.destroy();
    } catch {
      /* ignore */
    }
    tray = null;
  }
  const iconPath = asset('tray-icon.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(asset('icon.png')).resize({ width: 16, height: 16 });
  }
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  const status = embedMode
    ? isLocalServerRunning()
      ? 'Local office running'
      : 'Local office starting…'
    : 'Remote dashboard';
  tray.setToolTip(`TeamTracker Admin — ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Dashboard', click: () => createWindow() },
    {
      label: 'Open Website in Browser',
      click: () => { void openWebsiteInBrowser(); },
    },
    { type: 'separator' },
    {
      label: 'Change Dashboard Mode…',
      click: () => { void changeAdminUrl(); },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', () => createWindow());
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    try {
      const dockIcon = nativeImage.createFromPath(asset('icon.png'));
      if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    } catch { /* ignore */ }
  }

  const wantEmbed =
    store.get('useEmbeddedServer') !== false &&
    (shouldEmbedLocalServer() || process.env.TEAMTRACKER_EMBED_SERVER === '1');

  if (wantEmbed) {
    try {
      await startLocalServer();
      embedMode = true;
      store.set('adminUrl', LOCAL_ADMIN_URL);
    } catch (err) {
      embedMode = false;
      console.error('[local-server]', err);
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Local server unavailable',
        message: 'Could not start the embedded TeamTracker server.',
        detail:
          String(err) +
          '\n\nYou can point this app at an already-running server via Change Dashboard Mode.',
      });
    }
  }

  buildMenu();
  createTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else createWindow();
  });
});

app.on('before-quit', () => {
  stopLocalServer();
});

app.on('window-all-closed', () => {
  // Keep running in tray so the local office server stays up.
});
