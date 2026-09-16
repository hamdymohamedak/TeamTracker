// TeamTracker Admin — lightweight Electron shell around the web dashboard.
// Menu / tray includes "Open Website" so admins can use the browser instead.

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

const DEFAULT_ADMIN_URL =
  process.env.TEAMTRACKER_ADMIN_URL ||
  'http://localhost:3001';

const store = new Store<{ adminUrl: string }>({
  defaults: { adminUrl: DEFAULT_ADMIN_URL },
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function getAdminUrl(): string {
  const fromEnv = process.env.TEAMTRACKER_ADMIN_URL;
  if (fromEnv && /^https?:\/\//i.test(fromEnv)) return fromEnv.replace(/\/+$/, '');
  const stored = String(store.get('adminUrl') || DEFAULT_ADMIN_URL).trim();
  return (stored || DEFAULT_ADMIN_URL).replace(/\/+$/, '');
}

function asset(...parts: string[]): string {
  // Packaged: extraResources → process.resourcesPath/assets
  // Dev: next to dist via ../assets
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
    buttons: ['Copy current URL', 'Use localhost:3001', 'Use localhost:5174', 'Cancel'],
    defaultId: 0,
    cancelId: 3,
    title: 'Admin dashboard URL',
    message: 'Choose a dashboard URL for this app',
    detail:
      `Current: ${current}\n\n` +
      'Tip: set TEAMTRACKER_ADMIN_URL for production (e.g. https://track.example.com).\n' +
      'Or pick a local preset below. You can also paste a URL after Copy.',
  });

  if (result.response === 0) {
    clipboard.writeText(current);
    return;
  }
  if (result.response === 1) {
    store.set('adminUrl', 'http://localhost:3001');
  } else if (result.response === 2) {
    store.set('adminUrl', 'http://localhost:5174');
  } else {
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(getAdminUrl());
  }
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
          label: 'Change Dashboard URL…',
          click: () => { void changeAdminUrl(); },
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
  const iconPath = asset('tray-icon.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(asset('icon.png')).resize({ width: 16, height: 16 });
  }
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('TeamTracker Admin');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Dashboard', click: () => createWindow() },
    {
      label: 'Open Website in Browser',
      click: () => { void openWebsiteInBrowser(); },
    },
    { type: 'separator' },
    {
      label: 'Change Dashboard URL…',
      click: () => { void changeAdminUrl(); },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', () => createWindow());
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    try {
      const dockIcon = nativeImage.createFromPath(asset('icon.png'));
      if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    } catch { /* ignore */ }
  }
  buildMenu();
  createTray();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else createWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray on macOS; quit elsewhere when all windows close.
  if (process.platform !== 'darwin') {
    // Stay in tray on Windows/Linux too so "Open Website" remains available.
  }
});
