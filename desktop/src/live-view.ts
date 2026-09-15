// On-demand live screen streaming for the desktop tracker.
// Privacy: block when ANY open window matches (full-screen capture shows them).

import { desktopCapturer, screen } from 'electron';
import { shouldBlockLiveViewAsync } from './privacy-blocks.js';

type SendFn = (message: Record<string, unknown>) => void;
type ContextFn = () => { appName?: string; windowTitle?: string };

const TARGET_WIDTH = 960;
const JPEG_QUALITY = 42;
const FRAME_INTERVAL_MS = 280; // ~3.5 fps
const PRIVACY_REFRESH_MS = 1200;

let activeSessionId: string | null = null;
let frameTimer: NodeJS.Timeout | null = null;
let capturing = false;
let sendFn: SendFn | null = null;
let getContextFn: ContextFn | null = null;
let lastPrivacyBlocked = false;
let lastPrivacyCheckAt = 0;
let privacyBlockedCached = false;
let privacyMeta: { pattern?: string; appName?: string; windowTitle?: string } = {};
let privacyCheckInFlight: Promise<void> | null = null;

function stopCaptureLoop(): void {
  if (frameTimer) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
  capturing = false;
}

async function refreshPrivacyState(): Promise<void> {
  const fallback = getContextFn?.() || {};
  try {
    const blocked = await shouldBlockLiveViewAsync({
      appName: fallback.appName,
      windowTitle: fallback.windowTitle,
    });
    privacyBlockedCached = !!blocked;
    privacyMeta = {
      pattern: blocked?.pattern,
      appName: fallback.appName,
      windowTitle: fallback.windowTitle,
    };
    if (blocked && !lastPrivacyBlocked) {
      console.log(
        `[live-view] privacy block "${blocked.pattern}" via "${blocked.matchedVia}" ` +
        `in "${(blocked.matchedIn || '').slice(0, 80)}"`
      );
    }
    lastPrivacyBlocked = !!blocked;
  } catch (err) {
    console.warn('[live-view] privacy check failed:', (err as Error).message);
  }
}

function schedulePrivacyRefresh(): void {
  const now = Date.now();
  if (now - lastPrivacyCheckAt < PRIVACY_REFRESH_MS) return;
  if (privacyCheckInFlight) return;
  lastPrivacyCheckAt = now;
  privacyCheckInFlight = refreshPrivacyState().finally(() => {
    privacyCheckInFlight = null;
  });
}

async function captureFrame(): Promise<Buffer | null> {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;
  const targetWidth = Math.min(width, TARGET_WIDTH);
  const targetHeight = Math.round((height / width) * targetWidth);

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: targetWidth, height: targetHeight },
  });
  if (sources.length === 0) return null;
  const thumb = sources[0].thumbnail;
  if (thumb.isEmpty()) return null;
  return thumb.toJPEG(JPEG_QUALITY);
}

async function tick(): Promise<void> {
  if (!activeSessionId || !sendFn || capturing) return;
  capturing = true;
  try {
    schedulePrivacyRefresh();

    if (privacyBlockedCached) {
      sendFn({
        type: 'live-view:frame',
        data: {
          sessionId: activeSessionId,
          mimeType: 'image/jpeg',
          dataBase64: '',
          capturedAt: new Date().toISOString(),
          privacyBlocked: true,
          appName: privacyMeta.appName || null,
          windowTitle: privacyMeta.windowTitle || null,
          pattern: privacyMeta.pattern || null,
        },
      });
      return;
    }

    const buf = await captureFrame();
    if (!buf || !activeSessionId || !sendFn) return;
    const fallback = getContextFn?.() || {};
    sendFn({
      type: 'live-view:frame',
      data: {
        sessionId: activeSessionId,
        mimeType: 'image/jpeg',
        dataBase64: buf.toString('base64'),
        capturedAt: new Date().toISOString(),
        privacyBlocked: false,
        appName: fallback.appName || null,
        windowTitle: fallback.windowTitle || null,
      },
    });
  } catch (err) {
    console.warn('[live-view] frame failed:', (err as Error).message);
  } finally {
    capturing = false;
  }
}

export function configureLiveViewSender(send: SendFn, getContext?: ContextFn): void {
  sendFn = send;
  if (getContext) getContextFn = getContext;
}

export function configureLiveViewContext(getContext: ContextFn): void {
  getContextFn = getContext;
}

export function startLiveViewSession(sessionId: string): void {
  if (!sessionId) return;
  if (activeSessionId === sessionId && frameTimer) return;

  stopLiveViewSession('replaced');
  activeSessionId = sessionId;
  lastPrivacyBlocked = false;
  privacyBlockedCached = false;
  lastPrivacyCheckAt = 0;
  privacyMeta = {};
  console.log(`[live-view] started session ${sessionId}`);
  // Await first privacy check before sending real frames.
  void (async () => {
    await refreshPrivacyState();
    if (!activeSessionId) return;
    void tick();
    frameTimer = setInterval(() => void tick(), FRAME_INTERVAL_MS);
  })();
}

export function stopLiveViewSession(reason = 'stopped'): void {
  if (!activeSessionId && !frameTimer) return;
  const ended = activeSessionId;
  stopCaptureLoop();
  activeSessionId = null;
  lastPrivacyBlocked = false;
  privacyBlockedCached = false;
  if (ended && sendFn) {
    try {
      sendFn({
        type: 'live-view:ended',
        data: { sessionId: ended, reason },
      });
    } catch { /* ignore */ }
  }
  console.log(`[live-view] stopped (${reason})`);
}

export function isLiveViewActive(): boolean {
  return !!activeSessionId;
}
