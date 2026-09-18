import {
  allowedFpsOptions,
  clampEncodeLevel,
  clampFpsForPath,
  createAutoControllerState,
  decodeLiveViewBinaryFrame,
  detectNetworkPathFromStats,
  maxEncodeLevelForPath,
  mergeAutoConfig,
  mergeProfileConfig,
  parseLiveViewQualityMode,
  resolveEffectivePreset,
  tickAutoQuality,
  transitionLiveView,
  type IceCandidateType,
  type LiveViewAutoConfig,
  type LiveViewEncodeLevel,
  type LiveViewIceServer,
  type LiveViewNetworkPath,
  type LiveViewProfileConfig,
  type LiveViewQualityMode,
  type LiveViewSignalPayload,
  type LiveViewState,
  type LiveViewTransport,
} from '../../../shared/live-view/index';

export type LiveViewMetrics = {
  latencyMs: number | null;
  fps: number | null;
  targetFps: number | null;
  width: number | null;
  height: number | null;
  bitrateKbps: number | null;
  transport: LiveViewTransport;
  networkPath: LiveViewNetworkPath;
  iceLocalType: IceCandidateType | null;
  iceRemoteType: IceCandidateType | null;
  allowedFps: number[];
  ultraAllowed: boolean;
  state: LiveViewState;
  encodeLevel: LiveViewEncodeLevel;
  qualityMode: LiveViewQualityMode;
  error: string | null;
};

export type LiveViewControllerCallbacks = {
  sendJson: (message: Record<string, unknown>) => boolean;
  onMetrics?: (m: LiveViewMetrics) => void;
  onPrivacy?: (blocked: boolean, pattern?: string | null) => void;
  attachVideo?: (stream: MediaStream | null) => void;
  attachBinaryFrame?: (blobUrl: string | null, meta: { width: number; height: number; privacyBlocked: boolean }) => void;
};

const MAX_WEBRTC_ATTEMPTS = 5;
const MAX_REPROMOTE_ATTEMPTS = 3;
const REPROMOTE_COOLDOWN_MS = 8_000;

export class LiveViewSessionController {
  private state: LiveViewState = 'idle';
  private transport: LiveViewTransport = 'none';
  private networkPath: LiveViewNetworkPath = 'unknown';
  private iceLocalType: IceCandidateType | null = null;
  private iceRemoteType: IceCandidateType | null = null;
  private sessionId: string | null = null;
  private qualityMode: LiveViewQualityMode = 'auto';
  private encodeLevel: LiveViewEncodeLevel = 'medium';
  /** Admin-selected FPS override; null = use preset default for path. */
  private preferredFps: number | null = null;
  /** Remembered mode before Binary WS clamp (for LAN restore). */
  private preferredMode: LiveViewQualityMode = 'auto';
  private preferredEncodeLevel: LiveViewEncodeLevel = 'medium';
  private targetFps: number | null = null;
  private autoConfig: LiveViewAutoConfig = mergeAutoConfig();
  private profileConfig: LiveViewProfileConfig = mergeProfileConfig();
  private autoState = createAutoControllerState('medium', 12);
  private iceServers: LiveViewIceServer[] = [];
  private pc: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;
  private webrtcAttempts = 0;
  private repromoteAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private repromoteTimer: ReturnType<typeof setTimeout> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private lastObjectUrl: string | null = null;
  private frameTimes: number[] = [];
  private lastBytes = 0;
  private lastBytesAt = 0;
  private lastFramesDropped = 0;
  private bitrateKbps: number | null = null;
  private latencyMs: number | null = null;
  private width: number | null = null;
  private height: number | null = null;
  private error: string | null = null;
  private wsFallbackEnabled = true;
  private webrtcEnabled = true;
  private maxFrameBytes = 220_000;
  private destroyed = false;
  private pathApplied: LiveViewNetworkPath | null = null;

  constructor(private readonly cb: LiveViewControllerCallbacks) {}

  getMetrics(): LiveViewMetrics {
    return {
      latencyMs: this.latencyMs,
      fps: this.computeFps(),
      targetFps: this.targetFps,
      width: this.width,
      height: this.height,
      bitrateKbps: this.bitrateKbps,
      transport: this.transport,
      networkPath: this.networkPath,
      iceLocalType: this.iceLocalType,
      iceRemoteType: this.iceRemoteType,
      allowedFps: allowedFpsOptions(this.networkPath, this.profileConfig),
      ultraAllowed: this.networkPath === 'webrtc-p2p-lan',
      state: this.state,
      encodeLevel: this.encodeLevel,
      qualityMode: this.qualityMode,
      error: this.error,
    };
  }

  private setState(next: LiveViewState): void {
    const result = transitionLiveView(this.state, next);
    if (!result.ok) return;
    this.state = result.state;
    this.emitMetrics();
  }

  private emitMetrics(): void {
    this.cb.onMetrics?.(this.getMetrics());
  }

  private computeFps(): number | null {
    if (this.frameTimes.length < 2) return null;
    const span = this.frameTimes[this.frameTimes.length - 1] - this.frameTimes[0];
    if (span <= 0) return null;
    return Math.round(((this.frameTimes.length - 1) / span) * 1000 * 10) / 10;
  }

  private noteFrame(capturedAtMs?: number): void {
    const now = Date.now();
    this.frameTimes.push(now);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
    if (capturedAtMs && capturedAtMs > 0) {
      this.latencyMs = Math.max(0, now - capturedAtMs);
    }
  }

  start(employeeId: string, quality: LiveViewQualityMode = 'auto'): boolean {
    this.destroyed = false;
    this.qualityMode = quality;
    this.preferredMode = quality;
    this.error = null;
    this.webrtcAttempts = 0;
    this.repromoteAttempts = 0;
    this.networkPath = 'unknown';
    this.pathApplied = null;
    this.setState('starting');
    return this.cb.sendJson({
      type: 'admin:live-view-start',
      employeeId,
      quality,
    });
  }

  stop(): void {
    this.setState('stopping');
    this.cleanupMedia();
    this.cb.sendJson({ type: 'admin:live-view-stop' });
    this.sessionId = null;
    this.setState('stopped');
  }

  setQualityMode(mode: LiveViewQualityMode): void {
    if (mode === 'ultra' && this.networkPath !== 'webrtc-p2p-lan') {
      mode = 'high';
    }
    this.qualityMode = mode;
    this.preferredMode = mode;
    if (mode !== 'auto') {
      this.encodeLevel = mode;
      this.preferredEncodeLevel = mode;
      this.preferredFps = null;
      this.autoState = createAutoControllerState(mode, null);
    }
    this.pushEffectiveQuality(mode === 'auto' ? this.encodeLevel : mode, this.preferredFps);
    this.emitMetrics();
  }

  /** Discrete FPS pick from Dashboard; clamped to active path. */
  setTargetFps(fps: number): void {
    const clamped = clampFpsForPath(fps, this.networkPath, this.profileConfig);
    this.preferredFps = clamped;
    if (this.qualityMode === 'auto') {
      this.autoState = { ...this.autoState, fps: clamped };
    }
    this.pushEffectiveQuality(
      this.qualityMode === 'auto' ? this.encodeLevel : (this.qualityMode as LiveViewEncodeLevel),
      clamped
    );
    this.emitMetrics();
  }

  /** Push effective encode + fps (Auto or manual). */
  private pushEffectiveQuality(
    level: LiveViewEncodeLevel,
    fpsOverride: number | null = this.preferredFps
  ): void {
    const maxLevel = maxEncodeLevelForPath(this.networkPath);
    const safeLevel = clampEncodeLevel(level, maxLevel);
    this.encodeLevel = safeLevel;
    const preset = resolveEffectivePreset(
      safeLevel,
      this.networkPath,
      this.profileConfig,
      fpsOverride
    );
    this.targetFps = preset.fps;
    this.cb.sendJson({
      type: 'admin:live-view-quality',
      quality: this.qualityMode === 'auto' ? safeLevel : this.qualityMode,
      data: {
        quality: this.qualityMode === 'auto' ? safeLevel : this.qualityMode,
        encodeLevel: safeLevel,
        fps: preset.fps,
        width: preset.width,
        jpegQuality: preset.jpegQuality,
        maxBitrateBps: preset.maxBitrateBps,
        networkPath: this.networkPath,
      },
    });
    this.emitMetrics();
  }

  /** Push effective encode level while UI stays on Auto. */
  private pushAutoLevel(level: LiveViewEncodeLevel, fps: number | null): void {
    this.encodeLevel = level;
    this.preferredEncodeLevel = level;
    this.pushEffectiveQuality(level, fps);
  }

  handleStatus(data: Record<string, unknown>): void {
    if (!data?.active) {
      if (data?.error) this.error = String(data.error);
      this.setState('failed');
      return;
    }
    this.sessionId = typeof data.sessionId === 'string' ? data.sessionId : this.sessionId;
    this.qualityMode = parseLiveViewQualityMode(data.quality, this.qualityMode);
    this.preferredMode = this.qualityMode;
    this.webrtcEnabled = data.webrtcEnabled !== false;
    this.wsFallbackEnabled = data.wsFallbackEnabled !== false;
    this.maxFrameBytes = typeof data.maxFrameBytes === 'number' ? data.maxFrameBytes : this.maxFrameBytes;
    this.iceServers = Array.isArray(data.iceServers) ? (data.iceServers as LiveViewIceServer[]) : [];
    if (data.autoConfig && typeof data.autoConfig === 'object') {
      this.autoConfig = mergeAutoConfig(data.autoConfig as Partial<LiveViewAutoConfig>);
    }
    if (data.profileConfig && typeof data.profileConfig === 'object') {
      this.profileConfig = mergeProfileConfig(data.profileConfig as Partial<LiveViewProfileConfig>);
    } else if (typeof data.maxFps === 'number' || typeof data.minFps === 'number') {
      this.profileConfig = mergeProfileConfig({
        wsMaxFps: typeof data.maxFps === 'number' ? data.maxFps : this.profileConfig.wsMaxFps,
        wsMinFps: typeof data.minFps === 'number' ? data.minFps : this.profileConfig.wsMinFps,
      });
    }
    if (data.qualityUpdated) {
      this.emitMetrics();
      return;
    }
    this.beginTransport();
  }

  private beginTransport(): void {
    if (this.webrtcEnabled) {
      this.transport = 'webrtc';
      this.networkPath = 'unknown';
      this.setState('negotiating');
      void this.setupPeerConnection();
    } else {
      this.enterFallback('webrtc_disabled');
    }
    this.startAutoLoop();
  }

  private async setupPeerConnection(): Promise<void> {
    this.cleanupPeerOnly();
    this.webrtcAttempts += 1;
    try {
      this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
      this.remoteStream = new MediaStream();
      this.cb.attachVideo?.(this.remoteStream);

      this.pc.ontrack = (ev) => {
        ev.streams[0]?.getTracks().forEach((t) => this.remoteStream?.addTrack(t));
        if (!ev.streams[0] && ev.track) this.remoteStream?.addTrack(ev.track);
        this.transport = 'webrtc';
        this.setState('connected');
      };

      this.pc.onicecandidate = (ev) => {
        if (!ev.candidate || !this.sessionId) return;
        this.sendSignal({ type: 'ice', candidate: ev.candidate.toJSON() });
      };

      this.pc.onconnectionstatechange = () => {
        const st = this.pc?.connectionState;
        if (st === 'connected') {
          this.setState('connected');
          this.startStatsLoop();
          // After recovery from fallback, restore preferred LAN settings once path is known
        } else if (st === 'disconnected') {
          this.setState('degraded');
          this.scheduleReconnect('disconnected');
        } else if (st === 'failed') {
          this.handleWebRtcFailure('connection_failed');
        }
      };

      this.setState('connecting');
    } catch (err) {
      this.handleWebRtcFailure((err as Error).message);
    }
  }

  handleSignal(signal: LiveViewSignalPayload): void {
    if (!this.pc || !signal) return;
    void (async () => {
      try {
        if (signal.type === 'offer' && signal.sdp) {
          await this.pc!.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
          const answer = await this.pc!.createAnswer();
          await this.pc!.setLocalDescription(answer);
          this.sendSignal({ type: 'answer', sdp: answer.sdp });
          this.setState('connecting');
        } else if (signal.type === 'ice' && signal.candidate) {
          const c = signal.candidate;
          await this.pc!.addIceCandidate({
            candidate: c.candidate ?? undefined,
            sdpMid: c.sdpMid ?? undefined,
            sdpMLineIndex: c.sdpMLineIndex ?? undefined,
            usernameFragment: c.usernameFragment ?? undefined,
          });
        } else if (signal.type === 'fallback') {
          this.enterFallback(signal.reason || 'device_fallback');
        }
      } catch (err) {
        this.handleWebRtcFailure((err as Error).message);
      }
    })();
  }

  handleTransport(data: { transport?: string; state?: string; reason?: string }): void {
    if (data.transport === 'binary-ws') {
      this.enterFallback(data.reason || 'device_fallback');
    }
    if (data.transport === 'webrtc' && data.state === 'connected') {
      this.transport = 'webrtc';
      this.clearRepromoteTimer();
      if (this.state === 'fallback' || this.state === 'reconnecting') {
        this.setState('connected');
      }
    }
    if (data.state === 'connected' && this.transport === 'webrtc') {
      this.setState('connected');
    }
    if (data.state === 'degraded') {
      this.setState('degraded');
    }
  }

  handleBinaryFrame(buf: ArrayBuffer | Uint8Array): void {
    if (this.transport !== 'binary-ws' && this.state !== 'fallback' && this.state !== 'connected') {
      this.enterFallback('binary_frame');
    }
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const decoded = decodeLiveViewBinaryFrame(bytes, this.maxFrameBytes);
    if (!decoded.ok) return;
    if (this.sessionId && decoded.frame.sessionId !== this.sessionId) return;

    this.noteFrame(decoded.frame.capturedAtMs);
    this.width = decoded.frame.width || this.width;
    this.height = decoded.frame.height || this.height;

    if (decoded.frame.privacyBlocked) {
      this.cb.onPrivacy?.(true, null);
      this.cb.attachBinaryFrame?.(null, { width: 0, height: 0, privacyBlocked: true });
      this.emitMetrics();
      return;
    }

    this.cb.onPrivacy?.(false, null);
    const jpegCopy = new Uint8Array(decoded.frame.jpeg);
    const blob = new Blob([jpegCopy], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    if (this.lastObjectUrl) URL.revokeObjectURL(this.lastObjectUrl);
    this.lastObjectUrl = url;
    this.cb.attachBinaryFrame?.(url, {
      width: decoded.frame.width,
      height: decoded.frame.height,
      privacyBlocked: false,
    });
    if (this.state === 'fallback' || this.transport === 'binary-ws') {
      this.setState('connected');
    }
    this.emitMetrics();
  }

  /** Legacy Base64 JSON frame (older devices). */
  handleLegacyFrame(data: {
    dataBase64?: string;
    privacyBlocked?: boolean;
    capturedAt?: string;
    sessionId?: string;
  }): void {
    if (data.sessionId && this.sessionId && data.sessionId !== this.sessionId) return;
    if (this.transport !== 'binary-ws') this.enterFallback('legacy_json');
    const capturedAtMs = data.capturedAt ? Date.parse(data.capturedAt) : Date.now();
    this.noteFrame(capturedAtMs);
    if (data.privacyBlocked) {
      this.cb.onPrivacy?.(true, null);
      this.cb.attachBinaryFrame?.(null, { width: 0, height: 0, privacyBlocked: true });
      return;
    }
    const b64 = data.dataBase64 || '';
    if (!b64) return;
    this.cb.onPrivacy?.(false, null);
    this.cb.attachBinaryFrame?.(`data:image/jpeg;base64,${b64}`, {
      width: 0,
      height: 0,
      privacyBlocked: false,
    });
    this.setState('connected');
    this.emitMetrics();
  }

  private sendSignal(signal: LiveViewSignalPayload & { reason?: string }): void {
    if (!this.sessionId) return;
    this.cb.sendJson({
      type: 'admin:live-view-signal',
      data: { sessionId: this.sessionId, signal },
    });
  }

  private handleWebRtcFailure(reason: string): void {
    if (this.webrtcAttempts < MAX_WEBRTC_ATTEMPTS && this.state !== 'fallback') {
      this.setState('reconnecting');
      this.scheduleReconnect(reason);
      return;
    }
    this.enterFallback(reason);
  }

  private scheduleReconnect(reason: string): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const attempt = this.webrtcAttempts;
    const delay = Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), 8000);
    this.reconnectTimer = setTimeout(() => {
      if (this.destroyed) return;
      if (this.webrtcAttempts >= MAX_WEBRTC_ATTEMPTS) {
        this.enterFallback(reason);
        return;
      }
      void this.setupPeerConnection();
      this.sendSignal({ type: 'renegotiate', reason });
    }, delay);
  }

  private enterFallback(reason: string): void {
    if (this.transport === 'binary-ws' && this.networkPath === 'binary-ws') {
      return;
    }
    if (!this.wsFallbackEnabled) {
      this.error = reason;
      this.setState('failed');
      return;
    }
    this.cleanupPeerOnly();
    this.transport = 'binary-ws';
    this.applyNetworkPath('binary-ws', { immediate: true });
    this.setState('fallback');
    this.cb.attachVideo?.(null);
    this.sendSignal({ type: 'fallback', reason });
    this.cb.sendJson({
      type: 'live-view:transport',
      data: {
        sessionId: this.sessionId,
        transport: 'binary-ws',
        state: 'fallback',
        reason,
      },
    });
    this.scheduleRepromote();
  }

  /** Bounded Binary WS → WebRTC re-promote using existing signaling. */
  private scheduleRepromote(): void {
    this.clearRepromoteTimer();
    if (!this.webrtcEnabled || this.destroyed) return;
    if (this.repromoteAttempts >= MAX_REPROMOTE_ATTEMPTS) return;
    this.repromoteTimer = setTimeout(() => {
      if (this.destroyed || this.transport !== 'binary-ws') return;
      this.repromoteAttempts += 1;
      this.setState('reconnecting');
      this.webrtcAttempts = 0;
      void this.setupPeerConnection();
      this.sendSignal({ type: 'renegotiate', reason: 'repromote' });
    }, REPROMOTE_COOLDOWN_MS);
  }

  private clearRepromoteTimer(): void {
    if (this.repromoteTimer) {
      clearTimeout(this.repromoteTimer);
      this.repromoteTimer = null;
    }
  }

  private applyNetworkPath(
    path: LiveViewNetworkPath,
    opts: { immediate?: boolean; restorePreferred?: boolean } = {}
  ): void {
    const prev = this.networkPath;
    this.networkPath = path;
    if (this.pathApplied === path && !opts.immediate && !opts.restorePreferred) {
      return;
    }
    const pathChanged = this.pathApplied !== path;
    this.pathApplied = path;

    if (path === 'binary-ws') {
      // Immediate VPS-safe clamp; keep preferred* for later restore
      const level = clampEncodeLevel(
        this.qualityMode === 'auto' ? this.encodeLevel : (this.qualityMode as LiveViewEncodeLevel),
        'high'
      );
      this.encodeLevel = level;
      this.autoState = createAutoControllerState(level, null);
      this.pushEffectiveQuality(level, null);
      return;
    }

    if (opts.restorePreferred || (pathChanged && path === 'webrtc-p2p-lan' && prev === 'binary-ws')) {
      this.qualityMode = this.preferredMode;
      if (this.preferredMode !== 'auto') {
        this.encodeLevel = this.preferredEncodeLevel;
      }
      this.autoState = createAutoControllerState(
        this.encodeLevel,
        this.preferredFps ?? this.profileConfig.lanDefaultFps
      );
      this.pushEffectiveQuality(
        this.qualityMode === 'auto' ? this.encodeLevel : (this.qualityMode as LiveViewEncodeLevel),
        this.preferredFps
      );
      return;
    }

    if (pathChanged) {
      // Leaving LAN: clamp Ultra; entering LAN: allow higher caps
      if (this.qualityMode === 'ultra' && path !== 'webrtc-p2p-lan') {
        this.qualityMode = 'high';
        this.encodeLevel = 'high';
      }
      if (this.preferredFps != null) {
        this.preferredFps = clampFpsForPath(this.preferredFps, path, this.profileConfig);
      }
      this.autoState = {
        ...this.autoState,
        healthySinceMs: null,
        fps:
          path === 'webrtc-p2p-lan'
            ? this.preferredFps ?? this.profileConfig.lanDefaultFps
            : null,
      };
      this.pushEffectiveQuality(
        this.qualityMode === 'auto' ? this.encodeLevel : (this.qualityMode as LiveViewEncodeLevel),
        this.preferredFps
      );
    }
  }

  private startStatsLoop(): void {
    this.stopStatsLoop();
    this.statsTimer = setInterval(() => void this.sampleWebRtcStats(), 1000);
  }

  private stopStatsLoop(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  private async sampleWebRtcStats(): Promise<void> {
    if (!this.pc) return;
    try {
      const stats = await this.pc.getStats();
      const detected = detectNetworkPathFromStats(stats, this.profileConfig.lanRttMaxMs);
      this.iceLocalType = detected.localType;
      this.iceRemoteType = detected.remoteType;
      if (detected.path !== 'unknown') {
        const restoring = this.transport === 'webrtc' && this.networkPath === 'binary-ws';
        this.transport = 'webrtc';
        this.applyNetworkPath(detected.path, {
          restorePreferred: restoring || detected.path === 'webrtc-p2p-lan' && this.pathApplied === 'binary-ws',
        });
      } else if (this.networkPath === 'unknown' || this.networkPath === 'binary-ws') {
        this.applyNetworkPath('webrtc-p2p-internet');
      }

      let lost = 0;
      let received = 0;
      let bytes = 0;
      let width = 0;
      let height = 0;
      let fps = 0;
      let framesDropped = 0;
      let cpuLimited = false;

      stats.forEach((r) => {
        const c = r as Record<string, unknown>;
        if (r.type === 'inbound-rtp' && c.kind === 'video') {
          lost += Number(c.packetsLost || 0);
          received += Number(c.packetsReceived || 0);
          bytes += Number(c.bytesReceived || 0);
          fps = Number(c.framesPerSecond || fps);
          width = Number(c.frameWidth || width);
          height = Number(c.frameHeight || height);
          framesDropped += Number(c.framesDropped || 0);
        }
        if (r.type === 'inbound-rtp' && c.kind === 'video' && c.qualityLimitationReason === 'cpu') {
          cpuLimited = true;
        }
      });

      if (detected.rttMs != null) this.latencyMs = detected.rttMs;
      if (width) this.width = width;
      if (height) this.height = height;
      if (fps) {
        this.frameTimes = [Date.now() - 1000, Date.now()];
      }
      const now = Date.now();
      if (this.lastBytesAt && bytes >= this.lastBytes) {
        const dt = (now - this.lastBytesAt) / 1000;
        if (dt > 0) this.bitrateKbps = Math.round(((bytes - this.lastBytes) * 8) / dt / 1000);
      }
      this.lastBytes = bytes;
      this.lastBytesAt = now;

      const droppedRising = framesDropped > this.lastFramesDropped;
      this.lastFramesDropped = framesDropped;

      if (this.qualityMode === 'auto') {
        const lossRatio = received + lost > 0 ? lost / (received + lost) : 0;
        const effective = resolveEffectivePreset(
          this.encodeLevel,
          this.networkPath,
          this.profileConfig,
          this.autoState.fps
        );
        const result = tickAutoQuality(
          this.autoState,
          {
            nowMs: now,
            latencyMs: this.latencyMs ?? undefined,
            lossRatio,
            bitrateBps: this.bitrateKbps != null ? this.bitrateKbps * 1000 : undefined,
            presetMaxBitrateBps: effective.maxBitrateBps,
            cpuLimited: cpuLimited || droppedRising,
          },
          this.autoConfig,
          { networkPath: this.networkPath }
        );
        this.autoState = result.state;
        if (result.changed) {
          this.pushAutoLevel(result.state.level, result.state.fps);
        }
      }
      this.emitMetrics();
    } catch {
      /* ignore */
    }
  }

  private startAutoLoop(): void {
    this.stopAutoLoop();
    this.autoTimer = setInterval(() => {
      if (this.qualityMode !== 'auto') return;
      if (this.transport !== 'binary-ws') return;
      const effective = resolveEffectivePreset(
        this.encodeLevel,
        'binary-ws',
        this.profileConfig,
        null
      );
      const result = tickAutoQuality(
        this.autoState,
        {
          nowMs: Date.now(),
          latencyMs: this.latencyMs ?? undefined,
          backlog: 0,
          bitrateBps: this.bitrateKbps != null ? this.bitrateKbps * 1000 : undefined,
          presetMaxBitrateBps: effective.maxBitrateBps,
        },
        this.autoConfig,
        { networkPath: 'binary-ws', maxLevel: 'high' }
      );
      this.autoState = result.state;
      if (result.changed) this.pushAutoLevel(result.state.level, null);
    }, 1000);
  }

  private stopAutoLoop(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
  }

  private cleanupPeerOnly(): void {
    this.stopStatsLoop();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        /* ignore */
      }
      this.pc = null;
    }
    this.remoteStream = null;
  }

  private cleanupMedia(): void {
    this.cleanupPeerOnly();
    this.clearRepromoteTimer();
    this.stopAutoLoop();
    this.cb.attachVideo?.(null);
    if (this.lastObjectUrl) {
      URL.revokeObjectURL(this.lastObjectUrl);
      this.lastObjectUrl = null;
    }
    this.cb.attachBinaryFrame?.(null, { width: 0, height: 0, privacyBlocked: false });
    this.transport = 'none';
    this.networkPath = 'unknown';
    this.pathApplied = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.cleanupMedia();
    this.state = 'stopped';
  }
}
