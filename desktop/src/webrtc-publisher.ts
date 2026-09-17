/**
 * WebRTC live-view publisher — hidden BrowserWindow hosts RTCPeerConnection.
 * Main process owns privacy + source id; renderer owns media + PC.
 */

import { BrowserWindow, desktopCapturer, ipcMain, screen, app } from 'electron';
import * as path from 'path';
import type { LiveViewEncodeLevel, LiveViewIceServer, LiveViewSignalPayload } from './live-view-shared/index.js';
import { getQualityPreset } from './live-view-shared/index.js';

type SignalCb = (signal: LiveViewSignalPayload) => void;
type StateCb = (state: 'connected' | 'degraded' | 'failed', reason?: string) => void;

let captureWin: BrowserWindow | null = null;
let sessionId: string | null = null;
let onSignalCb: SignalCb | null = null;
let onStateCb: StateCb | null = null;
let ipcReady = false;
let privacyTimer: NodeJS.Timeout | null = null;

function assetPath(...parts: string[]): string {
  return path.join(app.getAppPath(), 'dist', ...parts);
}

function ensureIpc(): void {
  if (ipcReady) return;
  ipcReady = true;

  ipcMain.handle('live-view:get-source', async () => {
    const primary = screen.getPrimaryDisplay();
    const { width, height } = primary.size;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.min(width, 320), height: Math.min(height, 180) },
    });
    if (!sources.length) throw new Error('no_screen_source');
    // Prefer primary display when multiple sources exist.
    const match =
      sources.find((s) => s.display_id && String(s.display_id) === String(primary.id)) ||
      sources[0];
    return { id: match.id, name: match.name };
  });

  ipcMain.on('live-view:signal-out', (_event, signal: LiveViewSignalPayload) => {
    if (!sessionId || !onSignalCb) return;
    try {
      onSignalCb(signal);
    } catch { /* ignore */ }
  });

  ipcMain.on('live-view:pc-state', (_event, payload: { state: string; reason?: string }) => {
    if (!onStateCb) return;
    const s = payload?.state;
    if (s === 'connected' || s === 'degraded' || s === 'failed') {
      onStateCb(s, payload.reason);
    }
  });
}

function destroyWindow(): void {
  if (privacyTimer) {
    clearInterval(privacyTimer);
    privacyTimer = null;
  }
  if (captureWin && !captureWin.isDestroyed()) {
    try {
      captureWin.webContents.send('live-view:stop');
    } catch { /* ignore */ }
    try {
      captureWin.destroy();
    } catch { /* ignore */ }
  }
  captureWin = null;
}

export function isWebRtcPublisherActive(): boolean {
  return !!captureWin && !captureWin.isDestroyed();
}

export async function startWebRtcPublisher(opts: {
  sessionId: string;
  iceServers: LiveViewIceServer[];
  encodeLevel: LiveViewEncodeLevel;
  width?: number;
  fps?: number;
  maxBitrateBps?: number;
  onSignal: SignalCb;
  onState: StateCb;
}): Promise<void> {
  ensureIpc();
  destroyWindow();
  sessionId = opts.sessionId;
  onSignalCb = opts.onSignal;
  onStateCb = opts.onState;

  const preset = getQualityPreset(opts.encodeLevel === 'ultra' ? 'high' : opts.encodeLevel);
  const width = opts.width ?? preset.width;
  const fps = opts.fps ?? preset.fps;
  const maxBitrateBps = opts.maxBitrateBps ?? preset.maxBitrateBps;

  captureWin = new BrowserWindow({
    width: 2,
    height: 2,
    x: -200,
    y: -200,
    show: false,
    skipTaskbar: true,
    frame: false,
    transparent: true,
    focusable: false,
    resizable: false,
    webPreferences: {
      preload: assetPath('webrtc-capture-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  captureWin.on('closed', () => {
    captureWin = null;
  });

  await captureWin.loadFile(assetPath('webrtc-capture.html'));

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('webrtc_renderer_timeout')), 15_000);
    const onReady = () => {
      clearTimeout(timeout);
      ipcMain.removeListener('live-view:renderer-ready', onReady);
      resolve();
    };
    ipcMain.once('live-view:renderer-ready', onReady);
  });

  captureWin.webContents.send('live-view:start', {
    sessionId: opts.sessionId,
    iceServers: opts.iceServers,
    width,
    fps,
    maxBitrateBps,
  });

  console.log('[live_view] webrtc_offer_created');
}

export function sendWebRtcSignal(signal: LiveViewSignalPayload): void {
  if (!captureWin || captureWin.isDestroyed()) return;
  captureWin.webContents.send('live-view:signal-in', signal);
}

export function setWebRtcPrivacyBlocked(blocked: boolean, pattern: string | null): void {
  if (!captureWin || captureWin.isDestroyed()) return;
  captureWin.webContents.send('live-view:privacy', { blocked, pattern });
}

export async function setWebRtcEncodeLevel(level: LiveViewEncodeLevel): Promise<void> {
  if (!captureWin || captureWin.isDestroyed()) return;
  const preset = getQualityPreset(level === 'ultra' ? 'high' : level);
  captureWin.webContents.send('live-view:constraints', {
    width: preset.width,
    fps: preset.fps,
    maxBitrateBps: preset.maxBitrateBps,
  });
}

export async function setWebRtcConstraints(opts: {
  width: number;
  fps: number;
  maxBitrateBps: number;
}): Promise<void> {
  if (!captureWin || captureWin.isDestroyed()) return;
  captureWin.webContents.send('live-view:constraints', {
    width: opts.width,
    fps: opts.fps,
    maxBitrateBps: opts.maxBitrateBps,
  });
}

export async function stopWebRtcPublisher(): Promise<void> {
  destroyWindow();
  sessionId = null;
  onSignalCb = null;
  onStateCb = null;
}
