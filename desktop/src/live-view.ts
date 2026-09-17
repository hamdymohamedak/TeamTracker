// On-demand live screen streaming for the desktop tracker.
// All capture decisions go through PrivacyGuard (same gate as screenshots).

import { desktopCapturer, screen } from 'electron';
import { decide, isCaptureBlocked } from './privacy-guard.js';

type SendFn = (message: Record<string, unknown>) => void;
type ContextFn = () => { appName?: string; windowTitle?: string };

const TARGET_WIDTH = 960;
const JPEG_QUALITY = 42;
const FRAME_INTERVAL_MS = 280; // ~3.5 fps

let activeSessionId: string | null = null;
let frameTimer: NodeJS.Timeout | null = null;
let capturing = false;
let sendFn: SendFn | null = null;
let getContextFn: ContextFn | null = null;
let lastPrivacyBlocked = false;
let forcePrivacyRefresh = false;

function stopCaptureLoop(): void {
  if (frameTimer) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
  capturing = false;
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

function sendBlockedFrame(
  sessionId: string,
  meta: { pattern?: string | null; appName?: string | null; windowTitle?: string | null }
): void {
  if (!sendFn) return;
  sendFn({
    type: 'live-view:frame',
    data: {
      sessionId,
      mimeType: 'image/jpeg',
      dataBase64: '',
      capturedAt: new Date().toISOString(),
      privacyBlocked: true,
      appName: meta.appName || null,
      windowTitle: meta.windowTitle || null,
      pattern: meta.pattern || null,
    },
  });
}

async function tick(): Promise<void> {
  if (!activeSessionId || !sendFn || capturing) return;
  capturing = true;
  const sessionId = activeSessionId;
  const fallback = getContextFn?.() || {};
  try {
    // Await PrivacyGuard before any grab — never capture on block/unknown.
    // Probe results are coalesced + cached ~300ms inside PrivacyGuard.
    let privacy;
    try {
      const force = forcePrivacyRefresh;
      forcePrivacyRefresh = false;
      privacy = await decide('liveView', {
        appName: fallback.appName,
        windowTitle: fallback.windowTitle,
        forceRefresh: force,
      });
    } catch (err) {
      console.warn('[live-view] privacy check failed:', (err as Error).message);
      // Fail-closed: treat thrown errors as unavailable browser state.
      sendBlockedFrame(sessionId, {
        pattern: '(unavailable: privacy_check_error)',
        appName: fallback.appName,
        windowTitle: fallback.windowTitle,
      });
      lastPrivacyBlocked = true;
      return;
    }

    if (isCaptureBlocked(privacy)) {
      const pattern =
        privacy.state === 'block'
          ? privacy.pattern
          : privacy.state === 'unknown'
            ? `(unavailable: ${privacy.reason})`
            : '(blocked)';
      const windowTitle =
        privacy.state === 'block'
          ? privacy.matchedUrl || fallback.windowTitle
          : fallback.windowTitle;
      if (!lastPrivacyBlocked) {
        console.log(`[live-view] privacy block "${pattern}"`);
      }
      lastPrivacyBlocked = true;
      sendBlockedFrame(sessionId, {
        pattern,
        appName: fallback.appName,
        windowTitle,
      });
      return;
    }

    if (lastPrivacyBlocked) {
      console.log('[live-view] privacy cleared — capture resumed');
    }
    lastPrivacyBlocked = false;

    const buf = await captureFrame();
    if (!buf || !activeSessionId || !sendFn || activeSessionId !== sessionId) return;
    sendFn({
      type: 'live-view:frame',
      data: {
        sessionId,
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
  forcePrivacyRefresh = true;
  console.log(`[live-view] started session ${sessionId}`);
  // First tick awaits PrivacyGuard (force path via fresh session / cold cache).
  void (async () => {
    await tick();
    if (!activeSessionId) return;
    frameTimer = setInterval(() => void tick(), FRAME_INTERVAL_MS);
  })();
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
