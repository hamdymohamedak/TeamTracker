// On-demand live screen streaming for the desktop tracker.
// Capture runs ONLY while an admin has an active live-view session.
// Nothing streams by default — start/stop is driven by server commands.

import { desktopCapturer, screen } from 'electron';

type SendFn = (message: Record<string, unknown>) => void;

const TARGET_WIDTH = 960;
const JPEG_QUALITY = 42;
const FRAME_INTERVAL_MS = 280; // ~3.5 fps — light on CPU/bandwidth

let activeSessionId: string | null = null;
let frameTimer: NodeJS.Timeout | null = null;
let capturing = false;
let sendFn: SendFn | null = null;

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

async function tick(): Promise<void> {
  if (!activeSessionId || !sendFn || capturing) return;
  capturing = true;
  try {
    const buf = await captureFrame();
    if (!buf || !activeSessionId || !sendFn) return;
    sendFn({
      type: 'live-view:frame',
      data: {
        sessionId: activeSessionId,
        mimeType: 'image/jpeg',
        dataBase64: buf.toString('base64'),
        capturedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.warn('[live-view] frame failed:', (err as Error).message);
  } finally {
    capturing = false;
  }
}

export function configureLiveViewSender(send: SendFn): void {
  sendFn = send;
}

export function startLiveViewSession(sessionId: string): void {
  if (!sessionId) return;
  if (activeSessionId === sessionId && frameTimer) return;

  stopLiveViewSession('replaced');
  activeSessionId = sessionId;
  console.log(`[live-view] started session ${sessionId}`);
  void tick();
  frameTimer = setInterval(() => void tick(), FRAME_INTERVAL_MS);
}

export function stopLiveViewSession(reason = 'stopped'): void {
  if (!activeSessionId && !frameTimer) return;
  const ended = activeSessionId;
  stopCaptureLoop();
  activeSessionId = null;
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
