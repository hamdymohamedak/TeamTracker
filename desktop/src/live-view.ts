// On-demand live screen streaming for the desktop tracker.
// Capture runs ONLY while an admin has an active live-view session.
// Privacy checks use the tracker context first; active-window is refreshed
// at most every ~1.5s so a slow/broken active-win never stalls the stream.

import { desktopCapturer, screen } from 'electron';
import { getActiveWindow } from './active-window.js';
import { shouldBlockLiveView } from './privacy-blocks.js';

type SendFn = (message: Record<string, unknown>) => void;
type ContextFn = () => { appName?: string; windowTitle?: string };

const TARGET_WIDTH = 960;
const JPEG_QUALITY = 42;
const FRAME_INTERVAL_MS = 280; // ~3.5 fps
const PRIVACY_REFRESH_MS = 1500;

let activeSessionId: string | null = null;
let frameTimer: NodeJS.Timeout | null = null;
let capturing = false;
let sendFn: SendFn | null = null;
let getContextFn: ContextFn | null = null;
let cachedCtx: { appName?: string; windowTitle?: string } = {};
let lastPrivacyRefreshAt = 0;
let lastPrivacyBlocked = false;

function stopCaptureLoop(): void {
  if (frameTimer) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
  capturing = false;
}

async function refreshPrivacyContext(): Promise<void> {
  const fallback = getContextFn?.() || {};
  cachedCtx = { ...fallback, ...cachedCtx };
  if (fallback.appName) cachedCtx.appName = fallback.appName;
  if (fallback.windowTitle) cachedCtx.windowTitle = fallback.windowTitle;

  try {
    const win = await getActiveWindow();
    if (win) {
      cachedCtx = {
        appName: win.owner?.name || cachedCtx.appName || fallback.appName,
        windowTitle: win.title || cachedCtx.windowTitle || fallback.windowTitle,
      };
    }
  } catch { /* keep cache */ }
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
    const now = Date.now();
    if (now - lastPrivacyRefreshAt >= PRIVACY_REFRESH_MS) {
      lastPrivacyRefreshAt = now;
      // Don't await hard — fire and use last cache this frame if slow.
      void refreshPrivacyContext();
      // Prefer tracker context immediately (updated every ~10s by tracker).
      const fallback = getContextFn?.() || {};
      if (fallback.appName || fallback.windowTitle) {
        cachedCtx = {
          appName: fallback.appName || cachedCtx.appName,
          windowTitle: fallback.windowTitle || cachedCtx.windowTitle,
        };
      }
    }

    const ctx = cachedCtx;
    const blocked = shouldBlockLiveView(ctx.appName, ctx.windowTitle);
    if (blocked) {
      if (!lastPrivacyBlocked) {
        lastPrivacyBlocked = true;
        console.log(
          `[live-view] privacy block "${blocked.pattern}" via "${blocked.matchedVia}" ` +
          `(${ctx.appName || '?'} | ${ctx.windowTitle || '?'})`
        );
      }
      sendFn({
        type: 'live-view:frame',
        data: {
          sessionId: activeSessionId,
          mimeType: 'image/jpeg',
          dataBase64: '',
          capturedAt: new Date().toISOString(),
          privacyBlocked: true,
          appName: ctx.appName || null,
          windowTitle: ctx.windowTitle || null,
          pattern: blocked.pattern,
        },
      });
      return;
    }
    lastPrivacyBlocked = false;

    const buf = await captureFrame();
    if (!buf || !activeSessionId || !sendFn) return;
    sendFn({
      type: 'live-view:frame',
      data: {
        sessionId: activeSessionId,
        mimeType: 'image/jpeg',
        dataBase64: buf.toString('base64'),
        capturedAt: new Date().toISOString(),
        privacyBlocked: false,
        appName: ctx.appName || null,
        windowTitle: ctx.windowTitle || null,
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
  lastPrivacyRefreshAt = 0;
  cachedCtx = getContextFn?.() || {};
  console.log(`[live-view] started session ${sessionId}`);
  void refreshPrivacyContext();
  void tick();
  frameTimer = setInterval(() => void tick(), FRAME_INTERVAL_MS);
}

export function stopLiveViewSession(reason = 'stopped'): void {
  if (!activeSessionId && !frameTimer) return;
  const ended = activeSessionId;
  stopCaptureLoop();
  activeSessionId = null;
  lastPrivacyBlocked = false;
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
