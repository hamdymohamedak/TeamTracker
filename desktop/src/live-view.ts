// On-demand live screen streaming for the desktop tracker.
// Primary: WebRTC (hidden capture window). Fallback: binary JPEG over WebSocket.
// All capture decisions go through PrivacyGuard (same gate as screenshots).

import { desktopCapturer, screen } from 'electron';
import { getActiveWindow } from './active-window.js';
import { decide, isCaptureBlocked } from './privacy-guard.js';
import {
  LIVE_VIEW_DEFAULT_MAX_FRAME_BYTES,
  createUnchangedThrottleState,
  encodeLiveViewBinaryFrame,
  frameSignatureFromBuffer,
  getQualityPreset,
  isLiveViewEncodeLevel,
  parseLiveViewQualityMode,
  resolveEncodeLevel,
  shouldSendFrame,
  type LiveViewEncodeLevel,
  type LiveViewIceServer,
  type LiveViewQualityMode,
  type LiveViewSignalPayload,
  type UnchangedThrottleState,
} from './live-view-shared/index.js';
import {
  startWebRtcPublisher,
  stopWebRtcPublisher,
  sendWebRtcSignal,
  setWebRtcPrivacyBlocked,
  setWebRtcConstraints,
  isWebRtcPublisherActive,
} from './webrtc-publisher.js';

type SendFn = (message: Record<string, unknown>) => void;
type SendBinaryFn = (data: Buffer | Uint8Array) => void;
type ContextFn = () => { appName?: string; windowTitle?: string };

let activeSessionId: string | null = null;
let frameTimer: NodeJS.Timeout | null = null;
let capturing = false;
let sendFn: SendFn | null = null;
let sendBinaryFn: SendBinaryFn | null = null;
let getContextFn: ContextFn | null = null;
let lastPrivacyBlocked = false;
let forcePrivacyRefresh = false;

let qualityMode: LiveViewQualityMode = 'auto';
let encodeLevel: LiveViewEncodeLevel = 'medium';
let maxFrameBytes = LIVE_VIEW_DEFAULT_MAX_FRAME_BYTES;
let webrtcEnabled = true;
let wsFallbackEnabled = true;
let iceServers: LiveViewIceServer[] = [];
let transport: 'webrtc' | 'binary-ws' | 'none' = 'none';
let throttleState: UnchangedThrottleState = createUnchangedThrottleState();
let webrtcFailCount = 0;
/** Explicit constraints from admin (transport-aware). */
let effectiveWidth: number | null = null;
let effectiveFps: number | null = null;
let effectiveJpegQuality: number | null = null;
let effectiveMaxBitrateBps: number | null = null;
let lastContextSentAt = 0;
let lastContextKey = '';
const CONTEXT_MIN_INTERVAL_MS = 1500;

function formatLiveLabel(appName?: string | null, windowTitle?: string | null): string {
  const app = (appName || '').trim();
  const title = (windowTitle || '').trim();
  if (app && title && title.toLowerCase() !== app.toLowerCase()) {
    const browser =
      /chrome|firefox|safari|edge|brave|opera|vivaldi|arc|dia|chromium/i.test(app);
    if (browser) {
      const short = title.length > 40 ? `${title.slice(0, 37)}…` : title;
      return `${app} · ${short}`;
    }
    return app;
  }
  return app || title || '';
}

function sendLiveContext(meta: { appName?: string | null; windowTitle?: string | null }): void {
  if (!sendFn || !activeSessionId) return;
  const appName = meta.appName || null;
  const windowTitle = meta.windowTitle || null;
  const key = `${appName || ''}|${windowTitle || ''}`;
  const now = Date.now();
  if (key === lastContextKey && now - lastContextSentAt < CONTEXT_MIN_INTERVAL_MS) return;
  lastContextKey = key;
  lastContextSentAt = now;
  sendFn({
    type: 'live-view:context',
    data: {
      sessionId: activeSessionId,
      appName,
      windowTitle,
      label: formatLiveLabel(appName, windowTitle) || null,
      capturedAt: new Date().toISOString(),
    },
  });
}

function stopCaptureLoop(): void {
  if (frameTimer) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
  capturing = false;
}

function currentPreset() {
  const base = getQualityPreset(encodeLevel === 'ultra' ? 'high' : encodeLevel);
  const fps = effectiveFps ?? base.fps;
  return {
    ...base,
    width: effectiveWidth ?? base.width,
    jpegQuality: effectiveJpegQuality ?? base.jpegQuality,
    fps,
    intervalMs: Math.max(33, Math.round(1000 / Math.max(0.5, fps))),
    maxBitrateBps: effectiveMaxBitrateBps ?? base.maxBitrateBps,
  };
}

function logEvent(event: string, extra?: Record<string, unknown>): void {
  const bits = Object.entries(extra || {})
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  console.log(`[live_view] ${event}${bits ? ` ${bits}` : ''}`);
}

function announceTransport(state: string, reason?: string): void {
  if (!sendFn || !activeSessionId) return;
  sendFn({
    type: 'live-view:transport',
    data: {
      sessionId: activeSessionId,
      transport,
      state,
      reason: reason || null,
    },
  });
}

async function captureFrameProtected(
  targetWidth: number,
  jpegQuality: number
): Promise<{ buf: Buffer; width: number; height: number } | null> {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;
  let w = Math.min(width, targetWidth);
  let h = Math.round((height / width) * w);
  let quality = jpegQuality;

  for (let attempt = 0; attempt < 3; attempt++) {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: w, height: h },
    });
    if (sources.length === 0) return null;
    const thumb = sources[0].thumbnail;
    if (thumb.isEmpty()) return null;
    let buf = thumb.toJPEG(quality);
    if (buf.length <= maxFrameBytes) {
      return { buf, width: w, height: h };
    }
    // Step down quality then resolution before sending.
    if (attempt === 0) {
      quality = Math.max(18, Math.floor(quality * 0.7));
    } else {
      w = Math.max(320, Math.floor(w * 0.75));
      h = Math.round((height / width) * w);
      quality = Math.max(18, Math.floor(quality * 0.85));
    }
  }
  logEvent('frame_dropped', { reason: 'max_frame_bytes' });
  return null;
}

function sendBlockedBinary(
  sessionId: string,
  meta: { pattern?: string | null; appName?: string | null; windowTitle?: string | null }
): void {
  if (!sendBinaryFn && !sendFn) return;
  const packet = encodeLiveViewBinaryFrame({
    sessionId,
    capturedAtMs: Date.now(),
    width: 0,
    height: 0,
    jpeg: new Uint8Array(0),
    privacyBlocked: true,
  });
  if (sendBinaryFn) {
    sendBinaryFn(packet);
  } else if (sendFn) {
    // Extremely old path — should not happen once binary is wired.
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
}

async function privacyTick(): Promise<{
  blocked: boolean;
  pattern?: string | null;
  appName?: string | null;
  windowTitle?: string | null;
}> {
  const fallback = getContextFn?.() || {};
  let appName = fallback.appName ?? null;
  let windowTitle = fallback.windowTitle ?? null;
  try {
    const win = await getActiveWindow();
    if (win?.owner?.name) {
      appName = win.owner.name;
      windowTitle = win.title || windowTitle;
    }
  } catch { /* keep fallback */ }

  try {
    const force = forcePrivacyRefresh;
    forcePrivacyRefresh = false;
    const privacy = await decide('liveView', {
      appName,
      windowTitle,
      forceRefresh: force,
    });
    sendLiveContext({ appName, windowTitle });
    if (isCaptureBlocked(privacy)) {
      const pattern =
        privacy.state === 'block'
          ? privacy.pattern
          : privacy.state === 'unknown'
            ? `(unavailable: ${privacy.reason})`
            : '(blocked)';
      const blockedTitle =
        privacy.state === 'block'
          ? privacy.matchedUrl || windowTitle
          : windowTitle;
      return {
        blocked: true,
        pattern,
        appName,
        windowTitle: blockedTitle,
      };
    }
    return { blocked: false, appName, windowTitle };
  } catch (err) {
    console.warn('[live-view] privacy check failed:', (err as Error).message);
    return {
      blocked: true,
      pattern: '(unavailable: privacy_check_error)',
      appName,
      windowTitle,
    };
  }
}

async function binaryTick(): Promise<void> {
  if (!activeSessionId || capturing || transport !== 'binary-ws') return;
  capturing = true;
  const sessionId = activeSessionId;
  try {
    const privacy = await privacyTick();
    if (privacy.blocked) {
      if (!lastPrivacyBlocked) {
        logEvent('privacy_block', { pattern: privacy.pattern || '' });
      }
      lastPrivacyBlocked = true;
      sendBlockedBinary(sessionId, privacy);
      return;
    }
    if (lastPrivacyBlocked) {
      logEvent('privacy_cleared');
    }
    lastPrivacyBlocked = false;

    const preset = currentPreset();
    const captured = await captureFrameProtected(preset.width, preset.jpegQuality);
    if (!captured || !activeSessionId || activeSessionId !== sessionId) return;

    const hash = frameSignatureFromBuffer(captured.buf);
    const decision = shouldSendFrame(throttleState, hash, Date.now(), 4000);
    throttleState = decision.state;
    if (!decision.send) return;

    const packet = encodeLiveViewBinaryFrame({
      sessionId,
      capturedAtMs: Date.now(),
      width: captured.width,
      height: captured.height,
      jpeg: captured.buf,
      keepalive: decision.keepalive,
    });
    if (!sendBinaryFn) {
      logEvent('frame_dropped', { reason: 'no_binary_sender' });
      return;
    }
    sendBinaryFn(packet);
  } catch (err) {
    console.warn('[live-view] frame failed:', (err as Error).message);
  } finally {
    capturing = false;
  }
}

function startBinaryFallback(reason: string): void {
  if (!wsFallbackEnabled) {
    logEvent('webrtc_failed', { reason, fallback: false });
    return;
  }
  stopCaptureLoop();
  void stopWebRtcPublisher();
  transport = 'binary-ws';
  throttleState = createUnchangedThrottleState();
  logEvent('fallback_started', { reason });
  announceTransport('fallback', reason);
  const interval = currentPreset().intervalMs;
  void (async () => {
    await binaryTick();
    if (!activeSessionId || transport !== 'binary-ws') return;
    frameTimer = setInterval(() => void binaryTick(), interval);
    logEvent('fallback_connected');
  })();
}

async function startWebRtcOrFallback(): Promise<void> {
  if (!activeSessionId) return;
  if (!webrtcEnabled) {
    startBinaryFallback('webrtc_disabled');
    return;
  }

  transport = 'webrtc';
  announceTransport('negotiating');
  logEvent('webrtc_offer_creating');

  const preset = currentPreset();

  try {
    await startWebRtcPublisher({
      sessionId: activeSessionId,
      iceServers,
      encodeLevel,
      width: preset.width,
      fps: preset.fps,
      maxBitrateBps: preset.maxBitrateBps,
      onSignal: (signal) => {
        if (!sendFn || !activeSessionId) return;
        sendFn({
          type: 'live-view:signal',
          data: { sessionId: activeSessionId, signal },
        });
      },
      onState: (state, reason) => {
        if (state === 'connected') {
          webrtcFailCount = 0;
          announceTransport('connected');
          logEvent('webrtc_connected');
        } else if (state === 'degraded') {
          announceTransport('degraded', reason);
          logEvent('webrtc_degraded', { reason: reason || '' });
        } else if (state === 'failed') {
          webrtcFailCount += 1;
          logEvent('webrtc_failed', { reason: reason || '', failCount: webrtcFailCount });
          if (webrtcFailCount >= 2 || reason === 'ice_failed') {
            startBinaryFallback(reason || 'webrtc_failed');
          }
        }
      },
    });
  } catch (err) {
    logEvent('webrtc_failed', { reason: (err as Error).message });
    startBinaryFallback((err as Error).message);
  }
}

function restartBinaryInterval(): void {
  if (transport !== 'binary-ws' || !activeSessionId) return;
  stopCaptureLoop();
  frameTimer = setInterval(() => void binaryTick(), currentPreset().intervalMs);
}

function applyEffectiveConstraints(data?: Record<string, unknown> | null): void {
  if (!data) return;
  if (typeof data.width === 'number' && data.width > 0) effectiveWidth = data.width;
  if (typeof data.fps === 'number' && data.fps > 0) effectiveFps = data.fps;
  if (typeof data.jpegQuality === 'number' && data.jpegQuality > 0) {
    effectiveJpegQuality = data.jpegQuality;
  }
  if (typeof data.maxBitrateBps === 'number' && data.maxBitrateBps > 0) {
    effectiveMaxBitrateBps = data.maxBitrateBps;
  }
  if (isLiveViewEncodeLevel(data.encodeLevel)) {
    encodeLevel = data.encodeLevel;
  }
}

async function pushWebRtcConstraints(): Promise<void> {
  const preset = currentPreset();
  await setWebRtcConstraints({
    width: preset.width,
    fps: preset.fps,
    maxBitrateBps: preset.maxBitrateBps,
  });
}

export function configureLiveViewSender(send: SendFn, getContext?: ContextFn): void {
  sendFn = send;
  if (getContext) getContextFn = getContext;
}

export function configureLiveViewBinarySender(sendBinary: SendBinaryFn): void {
  sendBinaryFn = sendBinary;
}

export function configureLiveViewContext(getContext: ContextFn): void {
  getContextFn = getContext;
}

export function applyLiveViewQuality(
  quality: unknown,
  data?: Record<string, unknown> | null
): void {
  applyEffectiveConstraints(data || null);
  const mode = parseLiveViewQualityMode(
    data?.quality ?? quality,
    qualityMode
  );
  qualityMode = mode;
  if (isLiveViewEncodeLevel(data?.encodeLevel)) {
    encodeLevel = data.encodeLevel;
  } else {
    const nextLevel = resolveEncodeLevel(
      mode,
      mode === 'auto' ? encodeLevel : (mode as LiveViewEncodeLevel)
    );
    encodeLevel = nextLevel === 'ultra' ? 'high' : nextLevel;
  }
  // Binary WS hard safety: never exceed ~4 FPS interval from admin push without clamp
  if (transport === 'binary-ws' && effectiveFps != null && effectiveFps > 4) {
    // Admin should already clamp; belt-and-suspenders on device
    effectiveFps = Math.min(effectiveFps, 4);
  }
  logEvent('quality_changed', {
    mode,
    level: encodeLevel,
    fps: effectiveFps ?? currentPreset().fps,
    width: effectiveWidth ?? currentPreset().width,
  });
  void pushWebRtcConstraints();
  restartBinaryInterval();
}

/** Admin Auto controller can push an effective encode level while mode stays auto. */
export function applyLiveViewEncodeLevel(level: LiveViewEncodeLevel): void {
  encodeLevel = level === 'ultra' ? 'high' : level;
  logEvent('quality_changed', { mode: qualityMode, level: encodeLevel, source: 'auto_effective' });
  void pushWebRtcConstraints();
  restartBinaryInterval();
}

export function handleLiveViewSignal(signal: LiveViewSignalPayload): void {
  if (!activeSessionId) return;
  if (signal.type === 'fallback') {
    startBinaryFallback(signal.reason || 'admin_fallback');
    return;
  }
  // Admin re-promote: restart WebRTC from Binary WS using existing publisher
  if (signal.type === 'renegotiate' && transport === 'binary-ws') {
    stopCaptureLoop();
    webrtcFailCount = 0;
    void startWebRtcOrFallback();
    return;
  }
  sendWebRtcSignal(signal);
}

export function startLiveViewSession(
  sessionId: string,
  opts?: {
    quality?: unknown;
    webrtcEnabled?: boolean;
    wsFallbackEnabled?: boolean;
    maxFrameBytes?: number;
    iceServers?: LiveViewIceServer[];
  }
): void {
  if (!sessionId) return;
  if (activeSessionId === sessionId && (frameTimer || isWebRtcPublisherActive())) return;

  stopLiveViewSession('replaced');
  activeSessionId = sessionId;
  lastPrivacyBlocked = false;
  forcePrivacyRefresh = true;
  lastContextSentAt = 0;
  lastContextKey = '';
  webrtcFailCount = 0;
  throttleState = createUnchangedThrottleState();
  effectiveWidth = null;
  effectiveFps = null;
  effectiveJpegQuality = null;
  effectiveMaxBitrateBps = null;

  qualityMode = parseLiveViewQualityMode(opts?.quality, 'auto');
  encodeLevel = resolveEncodeLevel(qualityMode, 'medium');
  if (encodeLevel === 'ultra') encodeLevel = 'high';
  webrtcEnabled = opts?.webrtcEnabled !== false;
  wsFallbackEnabled = opts?.wsFallbackEnabled !== false;
  maxFrameBytes = Math.max(
    32_000,
    opts?.maxFrameBytes || LIVE_VIEW_DEFAULT_MAX_FRAME_BYTES
  );
  iceServers = Array.isArray(opts?.iceServers) ? opts!.iceServers! : [];

  logEvent('live_view_started', {
    sessionId,
    quality: qualityMode,
    level: encodeLevel,
    webrtc: webrtcEnabled,
  });

  void startWebRtcOrFallback();
}

export function stopLiveViewSession(reason = 'stopped'): void {
  if (!activeSessionId && !frameTimer && !isWebRtcPublisherActive()) return;
  const ended = activeSessionId;
  stopCaptureLoop();
  void stopWebRtcPublisher();
  transport = 'none';
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
  logEvent('stream_stopped', { reason });
}

export function isLiveViewActive(): boolean {
  return !!activeSessionId;
}

export async function refreshLiveViewPrivacyGate(): Promise<void> {
  if (!activeSessionId || transport !== 'webrtc') return;
  const privacy = await privacyTick();
  if (privacy.blocked !== lastPrivacyBlocked) {
    lastPrivacyBlocked = privacy.blocked;
    setWebRtcPrivacyBlocked(privacy.blocked, privacy.pattern || null);
  } else {
    setWebRtcPrivacyBlocked(privacy.blocked, privacy.pattern || null);
  }
}
