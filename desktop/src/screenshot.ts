// Periodic + on-demand screenshot capture for the desktop tracker.
//
// Uses Electron's `desktopCapturer` API which works on macOS, Windows, and
// Linux. On Wayland, Chromium talks to the XDG Desktop Portal / PipeWire
// screencast path — the OS may prompt once for screen-share permission.
// Capture is in-memory, JPEG @ 70% quality, uploaded as base64 to
// POST /api/screenshots with the device JWT. No child process / UI flash
// on X11, Windows, or macOS.
//
// The interval and the on/off switch come from the server's
// /api/organization endpoint, polled once on startup and every few minutes.
// On-demand captures are triggered by remote commands (WebSocket / poll).

import { desktopCapturer, screen } from 'electron';
import { getServerUrl } from './config.js';

interface ScreenshotConfig {
  enabled: boolean;
  intervalMinutes: number;
}

interface PolledOrgSettings {
  screenshotsEnabled: boolean;
  screenshotIntervalMinutes: number;
}

export interface CaptureResult {
  ok: boolean;
  id?: string;
  fileUrl?: string;
  error?: string;
}

let currentConfig: ScreenshotConfig = { enabled: false, intervalMinutes: 10 };
let captureTimer: NodeJS.Timeout | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let getTokenFn: (() => string) | null = null;
let getContextFn: (() => { appName?: string; windowTitle?: string }) | null = null;

function readDeviceToken(getCurrentToken: () => string): string {
  return getCurrentToken();
}

/**
 * Capture the primary display, encode as JPEG, and upload to the server.
 * Used by both the periodic loop and on-demand remote commands.
 */
export async function captureNow(
  getCurrentToken: () => string,
  getCurrentContext: () => { appName?: string; windowTitle?: string },
  opts?: { requestId?: string; trigger?: 'periodic' | 'on_demand' }
): Promise<CaptureResult> {
  try {
    const primary = screen.getPrimaryDisplay();
    const { width, height } = primary.size;
    // 1280px max width keeps each screenshot under ~250 KB at JPEG q=70.
    const targetWidth = Math.min(width, 1280);
    const targetHeight = Math.round((height / width) * targetWidth);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: targetWidth, height: targetHeight }
    });
    if (sources.length === 0) {
      return { ok: false, error: 'No screen sources available' };
    }

    const thumb = sources[0].thumbnail;
    if (thumb.isEmpty()) {
      return { ok: false, error: 'Empty screen thumbnail' };
    }

    const jpegBuffer = thumb.toJPEG(70);
    const dataBase64 = jpegBuffer.toString('base64');

    const token = readDeviceToken(getCurrentToken);
    if (!token) {
      console.warn('[screenshot] no device token, skipping upload');
      return { ok: false, error: 'No device token' };
    }

    const ctx = getCurrentContext();
    const serverUrl = getServerUrl();
    const body: Record<string, unknown> = {
      mimeType: 'image/jpeg',
      dataBase64,
      capturedAt: new Date().toISOString(),
      appName: ctx.appName || null,
      windowTitle: ctx.windowTitle || null,
      width: targetWidth,
      height: targetHeight,
      trigger: opts?.trigger || 'periodic',
    };
    if (opts?.requestId) body.requestId = opts.requestId;

    const res = await fetch(`${serverUrl}/api/screenshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    if (res.status === 403 && opts?.trigger !== 'on_demand') {
      // Org disabled periodic screenshots — stop the capture loop until the
      // next poll re-enables it. On-demand uploads are allowed separately.
      console.log('[screenshot] org disabled screenshots, pausing capture loop');
      stopCaptureLoop();
      return { ok: false, error: 'Screenshots disabled' };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      console.warn('[screenshot] upload failed:', res.status, text);
      return { ok: false, error: `Upload failed (${res.status})` };
    }

    const json = await res.json().catch(() => null) as {
      success?: boolean;
      data?: { id?: string; fileUrl?: string };
    } | null;

    return {
      ok: true,
      id: json?.data?.id,
      fileUrl: json?.data?.fileUrl,
    };
  } catch (e) {
    console.warn('[screenshot] capture failed:', (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

async function captureAndUpload(
  getCurrentToken: () => string,
  getCurrentContext: () => { appName?: string; windowTitle?: string }
): Promise<void> {
  await captureNow(getCurrentToken, getCurrentContext, { trigger: 'periodic' });
}

/**
 * Poll the server for the current screenshot policy. The org admin can
 * change the toggle / interval at any time and we want the running tracker
 * to pick it up without a restart.
 */
async function fetchSettings(getCurrentToken: () => string): Promise<PolledOrgSettings | null> {
  try {
    const token = getCurrentToken();
    if (!token) return null;
    const serverUrl = getServerUrl();
    const res = await fetch(`${serverUrl}/api/organization`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const json = await res.json() as { success: boolean; data?: PolledOrgSettings };
    if (!json.success || !json.data) return null;
    return {
      screenshotsEnabled: !!json.data.screenshotsEnabled,
      screenshotIntervalMinutes: typeof json.data.screenshotIntervalMinutes === 'number'
        ? json.data.screenshotIntervalMinutes
        : 10
    };
  } catch {
    return null;
  }
}

function startCaptureLoop(
  intervalMs: number,
  getCurrentToken: () => string,
  getCurrentContext: () => { appName?: string; windowTitle?: string }
): void {
  if (captureTimer) clearInterval(captureTimer);
  captureTimer = setInterval(() => captureAndUpload(getCurrentToken, getCurrentContext), intervalMs);
  // Fire one immediately so the admin sees activity right away after enabling.
  setTimeout(() => captureAndUpload(getCurrentToken, getCurrentContext), 5000);
  console.log(`[screenshot] capture loop started, every ${intervalMs / 60000} minutes`);
}

function stopCaptureLoop(): void {
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
    console.log('[screenshot] capture loop stopped');
  }
}

/**
 * Public entry point — starts the polling loop and (if enabled) the
 * capture loop. Re-checks org settings every 2 minutes.
 */
export function startScreenshotService(
  getCurrentToken: () => string,
  getCurrentContext: () => { appName?: string; windowTitle?: string }
): void {
  getTokenFn = getCurrentToken;
  getContextFn = getCurrentContext;

  const reconcile = async () => {
    const settings = await fetchSettings(getCurrentToken);
    if (!settings) return;

    const intervalChanged = settings.screenshotIntervalMinutes !== currentConfig.intervalMinutes;
    const enabledChanged = settings.screenshotsEnabled !== currentConfig.enabled;
    currentConfig = {
      enabled: settings.screenshotsEnabled,
      intervalMinutes: settings.screenshotIntervalMinutes
    };

    if (settings.screenshotsEnabled) {
      if (enabledChanged || intervalChanged || !captureTimer) {
        startCaptureLoop(settings.screenshotIntervalMinutes * 60 * 1000, getCurrentToken, getCurrentContext);
      }
    } else {
      if (captureTimer) stopCaptureLoop();
    }
  };

  // Reconcile shortly after boot, then every 2 minutes (was hourly).
  setTimeout(reconcile, 7000);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(reconcile, 2 * 60 * 1000);
}

/** Capture using the active service callbacks (for remote commands). */
export async function captureWithService(
  opts?: { requestId?: string; trigger?: 'periodic' | 'on_demand' }
): Promise<CaptureResult> {
  if (!getTokenFn || !getContextFn) {
    return { ok: false, error: 'Screenshot service not started' };
  }
  return captureNow(getTokenFn, getContextFn, opts);
}
