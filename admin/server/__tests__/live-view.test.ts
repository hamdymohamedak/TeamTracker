import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeLiveViewBinaryFrame,
  decodeLiveViewBinaryFrame,
  peekLiveViewBinaryMagic,
  LIVE_VIEW_DEFAULT_MAX_FRAME_BYTES,
} from '../../shared/live-view/binary.js';
import {
  LIVE_VIEW_QUALITY_PRESETS,
  getQualityPreset,
  parseLiveViewQualityMode,
  resolveEncodeLevel,
  stepEncodeLevel,
} from '../../shared/live-view/quality.js';
import {
  createAutoControllerState,
  tickAutoQuality,
  DEFAULT_LIVE_VIEW_AUTO_CONFIG,
} from '../../shared/live-view/auto.js';
import {
  allowedFpsOptions,
  classifyIcePath,
  clampFpsForPath,
  detectNetworkPathFromStats,
  maxEncodeLevelForPath,
  resolveEffectivePreset,
} from '../../shared/live-view/transport-profiles.js';
import {
  canTransitionLiveView,
  transitionLiveView,
} from '../../shared/live-view/states.js';
import {
  createUnchangedThrottleState,
  shouldSendFrame,
  frameSignatureFromBuffer,
  hashBytesFnv1a,
} from '../../shared/live-view/unchanged.js';
import {
  mintTurnCredentials,
  resetLiveViewEnvCache,
  getLiveViewEnv,
  buildIceServers,
} from '../live-view-config.js';

describe('live-view quality presets', () => {
  it('exposes low/medium/high with expected baselines', () => {
    assert.equal(LIVE_VIEW_QUALITY_PRESETS.low.width, 480);
    assert.equal(LIVE_VIEW_QUALITY_PRESETS.medium.width, 720);
    assert.equal(LIVE_VIEW_QUALITY_PRESETS.high.width, 1280);
    assert.equal(getQualityPreset('medium').jpegQuality, 34);
  });

  it('parses quality modes and resolves auto to medium by default', () => {
    assert.equal(parseLiveViewQualityMode('auto'), 'auto');
    assert.equal(parseLiveViewQualityMode('nope', 'high'), 'high');
    assert.equal(resolveEncodeLevel('auto'), 'medium');
    assert.equal(resolveEncodeLevel('low'), 'low');
  });

  it('steps encode levels without leaving bounds', () => {
    assert.equal(stepEncodeLevel('low', -1), 'low');
    assert.equal(stepEncodeLevel('low', 1), 'medium');
    assert.equal(stepEncodeLevel('high', 1, 'high'), 'high');
    assert.equal(stepEncodeLevel('high', 1, 'ultra'), 'ultra');
    assert.equal(stepEncodeLevel('ultra', 1, 'ultra'), 'ultra');
  });
});

describe('live-view transport profiles', () => {
  it('classifies ICE host/prflx + low RTT as LAN', () => {
    assert.equal(
      classifyIcePath({ localType: 'host', remoteType: 'host', rttMs: 8 }),
      'webrtc-p2p-lan'
    );
    assert.equal(
      classifyIcePath({ localType: 'host', remoteType: 'prflx', rttMs: 20 }),
      'webrtc-p2p-lan'
    );
  });

  it('classifies srflx or high RTT as Internet P2P', () => {
    assert.equal(
      classifyIcePath({ localType: 'srflx', remoteType: 'srflx', rttMs: 10 }),
      'webrtc-p2p-internet'
    );
    assert.equal(
      classifyIcePath({ localType: 'host', remoteType: 'host', rttMs: 120 }),
      'webrtc-p2p-internet'
    );
  });

  it('classifies any relay as TURN', () => {
    assert.equal(
      classifyIcePath({ localType: 'relay', remoteType: 'srflx', rttMs: 40 }),
      'webrtc-turn'
    );
    assert.equal(
      classifyIcePath({ localType: 'host', remoteType: 'relay', rttMs: 5 }),
      'webrtc-turn'
    );
  });

  it('detects path from mock RTCStats', () => {
    const reports = new Map<string, Record<string, unknown>>([
      ['t1', { type: 'transport', selectedCandidatePairId: 'p1' }],
      [
        'p1',
        {
          type: 'candidate-pair',
          id: 'p1',
          state: 'succeeded',
          localCandidateId: 'cL',
          remoteCandidateId: 'cR',
          currentRoundTripTime: 0.012,
        },
      ],
      ['cL', { type: 'local-candidate', candidateType: 'host' }],
      ['cR', { type: 'remote-candidate', candidateType: 'host' }],
    ]);
    const stats = {
      forEach(cb: (report: Record<string, unknown>, id: string) => void) {
        for (const [id, report] of reports) cb(report, id);
      },
    };
    const detected = detectNetworkPathFromStats(stats, 40);
    assert.equal(detected.path, 'webrtc-p2p-lan');
    assert.equal(detected.localType, 'host');
    assert.equal(detected.remoteType, 'host');
  });

  it('resolves Medium differently for LAN vs Internet', () => {
    const lan = resolveEffectivePreset('medium', 'webrtc-p2p-lan');
    const inet = resolveEffectivePreset('medium', 'webrtc-p2p-internet');
    assert.equal(lan.width, 720);
    assert.ok(lan.fps >= 10);
    assert.equal(inet.width, 720);
    assert.ok(inet.fps <= 4);
  });

  it('clamps Binary WS to VPS-safe FPS and rejects LAN Ultra through WS', () => {
    const ws = resolveEffectivePreset('ultra', 'binary-ws', undefined, 30);
    assert.notEqual(ws.level, 'ultra');
    assert.ok(ws.fps <= 4);
    assert.ok(!allowedFpsOptions('binary-ws').includes(30));
    assert.ok(!allowedFpsOptions('webrtc-turn').includes(30));
    assert.ok(allowedFpsOptions('webrtc-p2p-lan').includes(30));
  });

  it('clampFpsForPath snaps to allowed discrete options', () => {
    assert.equal(clampFpsForPath(14, 'webrtc-p2p-lan'), 15);
    assert.equal(clampFpsForPath(30, 'binary-ws'), 4);
    assert.equal(clampFpsForPath(3, 'webrtc-turn'), 3);
  });

  it('Auto on LAN raises FPS before resolution; TURN never reaches Ultra', () => {
    const cfg = {
      ...DEFAULT_LIVE_VIEW_AUTO_CONFIG,
      upgradeDelayMs: 500,
      downgradeCooldownMs: 0,
    };
    let state = createAutoControllerState('medium', 5);
    let r = tickAutoQuality(
      state,
      { nowMs: 1000, latencyMs: 20 },
      cfg,
      { networkPath: 'webrtc-p2p-lan' }
    );
    assert.equal(r.changed, false);
    state = r.state;
    r = tickAutoQuality(
      state,
      { nowMs: 1600, latencyMs: 20 },
      cfg,
      { networkPath: 'webrtc-p2p-lan' }
    );
    assert.equal(r.changed, true);
    assert.equal(r.state.level, 'medium');
    assert.equal(r.state.fps, 10);

    // Degraded → FPS down
    r = tickAutoQuality(
      r.state,
      { nowMs: 2000, latencyMs: 2000 },
      cfg,
      { networkPath: 'webrtc-p2p-lan' }
    );
    assert.equal(r.changed, true);
    assert.equal(r.state.fps, 5);

    // TURN: max level high, never ultra
    state = createAutoControllerState('high', null);
    r = tickAutoQuality(
      state,
      { nowMs: 3000, latencyMs: 50 },
      { ...cfg, upgradeDelayMs: 100 },
      { networkPath: 'webrtc-turn' }
    );
    state = r.state;
    r = tickAutoQuality(
      state,
      { nowMs: 3200, latencyMs: 50 },
      { ...cfg, upgradeDelayMs: 100 },
      { networkPath: 'webrtc-turn' }
    );
    assert.notEqual(r.state.level, 'ultra');
    assert.equal(maxEncodeLevelForPath('webrtc-turn'), 'high');
    assert.equal(maxEncodeLevelForPath('webrtc-p2p-lan'), 'ultra');
  });

  it('loads profile env caps into LiveViewEnvConfig', () => {
    resetLiveViewEnvCache();
    process.env.LAN_LIVE_VIEW_MAX_FPS = '25';
    process.env.LAN_LIVE_VIEW_DEFAULT_FPS = '10';
    process.env.LIVE_VIEW_MAX_FPS = '3';
    resetLiveViewEnvCache();
    const cfg = getLiveViewEnv();
    assert.equal(cfg.profiles.lanMaxFps, 25);
    assert.equal(cfg.profiles.lanDefaultFps, 10);
    assert.equal(cfg.profiles.wsMaxFps, 3);
    assert.equal(cfg.maxFps, 3);
    delete process.env.LAN_LIVE_VIEW_MAX_FPS;
    delete process.env.LAN_LIVE_VIEW_DEFAULT_FPS;
    delete process.env.LIVE_VIEW_MAX_FPS;
    resetLiveViewEnvCache();
  });
});

describe('live-view auto hysteresis', () => {
  it('downgrades on high latency and upgrades only after stable delay', () => {
    let state = createAutoControllerState('high');
    const cfg = { ...DEFAULT_LIVE_VIEW_AUTO_CONFIG, upgradeDelayMs: 1000, downgradeCooldownMs: 0 };

    let r = tickAutoQuality(state, { nowMs: 1000, latencyMs: 2000 }, cfg);
    assert.equal(r.changed, true);
    assert.equal(r.state.level, 'medium');
    state = r.state;

    r = tickAutoQuality(state, { nowMs: 1100, latencyMs: 2000 }, cfg);
    assert.equal(r.changed, true);
    assert.equal(r.state.level, 'low');
    state = r.state;

    // Healthy but not long enough — no upgrade
    r = tickAutoQuality(state, { nowMs: 1200, latencyMs: 200 }, cfg);
    assert.equal(r.changed, false);
    state = r.state;

    r = tickAutoQuality(state, { nowMs: 2500, latencyMs: 200 }, cfg);
    assert.equal(r.changed, true);
    assert.equal(r.state.level, 'medium');
  });

  it('does not oscillate across rapid unhealthy/healthy flips within cooldown', () => {
    let state = createAutoControllerState('medium');
    const cfg = { ...DEFAULT_LIVE_VIEW_AUTO_CONFIG, downgradeCooldownMs: 5000, upgradeDelayMs: 20_000 };

    let r = tickAutoQuality(state, { nowMs: 1000, latencyMs: 2000 }, cfg);
    assert.equal(r.state.level, 'low');
    state = r.state;

    r = tickAutoQuality(state, { nowMs: 1500, latencyMs: 100 }, cfg);
    assert.equal(r.changed, false);
    assert.equal(r.state.level, 'low');

    r = tickAutoQuality(state, { nowMs: 2000, latencyMs: 2000 }, cfg);
    assert.equal(r.changed, false); // cooldown blocks another downgrade (already low anyway)
  });
});

describe('live-view binary TLV1', () => {
  it('round-trips jpeg payload', () => {
    const sessionId = '11111111-2222-3333-4444-555555555555';
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const encoded = encodeLiveViewBinaryFrame({
      sessionId,
      capturedAtMs: 1_700_000_000_000,
      width: 720,
      height: 405,
      jpeg,
    });
    assert.equal(peekLiveViewBinaryMagic(encoded), true);
    const decoded = decodeLiveViewBinaryFrame(encoded);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.frame.sessionId, sessionId);
    assert.equal(decoded.frame.width, 720);
    assert.equal(decoded.frame.jpeg.length, 4);
    assert.equal(decoded.frame.privacyBlocked, false);
  });

  it('rejects bad magic and oversized payloads', () => {
    const bad = new Uint8Array(40);
    assert.equal(decodeLiveViewBinaryFrame(bad).ok, false);

    const sessionId = '11111111-2222-3333-4444-555555555555';
    const huge = new Uint8Array(LIVE_VIEW_DEFAULT_MAX_FRAME_BYTES + 10);
    const encoded = encodeLiveViewBinaryFrame({
      sessionId,
      capturedAtMs: Date.now(),
      width: 100,
      height: 100,
      jpeg: huge,
    });
    const decoded = decodeLiveViewBinaryFrame(encoded, LIVE_VIEW_DEFAULT_MAX_FRAME_BYTES);
    assert.equal(decoded.ok, false);
  });

  it('encodes privacy-blocked empty frames', () => {
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const encoded = encodeLiveViewBinaryFrame({
      sessionId,
      capturedAtMs: Date.now(),
      width: 0,
      height: 0,
      privacyBlocked: true,
    });
    const decoded = decodeLiveViewBinaryFrame(encoded);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) return;
    assert.equal(decoded.frame.privacyBlocked, true);
    assert.equal(decoded.frame.jpeg.length, 0);
  });
});

describe('unchanged frame throttle', () => {
  it('skips identical hashes until force refresh', () => {
    let state = createUnchangedThrottleState();
    const hash = hashBytesFnv1a(new Uint8Array([1, 2, 3]));
    let r = shouldSendFrame(state, hash, 1000, 4000);
    assert.equal(r.send, true);
    state = r.state;
    r = shouldSendFrame(state, hash, 1500, 4000);
    assert.equal(r.send, false);
    r = shouldSendFrame(state, hash, 5500, 4000);
    assert.equal(r.send, true);
    assert.equal(r.keepalive, true);
  });

  it('sends when screen signature changes', () => {
    const a = frameSignatureFromBuffer(new Uint8Array([1, 1, 1, 1]));
    const b = frameSignatureFromBuffer(new Uint8Array([9, 9, 9, 9]));
    assert.notEqual(a, b);
    let state = createUnchangedThrottleState();
    let r = shouldSendFrame(state, a, 0);
    state = r.state;
    r = shouldSendFrame(state, b, 10);
    assert.equal(r.send, true);
    assert.equal(r.keepalive, false);
  });
});

describe('live-view state machine', () => {
  it('allows connected → degraded → reconnecting → fallback', () => {
    assert.equal(canTransitionLiveView('connected', 'degraded'), true);
    assert.equal(canTransitionLiveView('degraded', 'reconnecting'), true);
    assert.equal(canTransitionLiveView('reconnecting', 'fallback'), true);
    assert.equal(transitionLiveView('idle', 'connected').ok, false);
  });
});

describe('TURN credential minting', () => {
  it('creates hmac credentials', () => {
    const minted = mintTurnCredentials('test-secret', 'org-1', 3600);
    assert.match(minted.username, /^\d+:org-1$/);
    assert.ok(minted.credential.length > 10);
  });

  it('builds ice servers from env without throwing', () => {
    resetLiveViewEnvCache();
    process.env.STUN_SERVERS = 'stun:example.test:3478';
    process.env.TURN_URLS = 'turn:example.test:3478';
    process.env.TURN_SECRET = 'unit-test-secret';
    resetLiveViewEnvCache();
    const cfg = getLiveViewEnv();
    assert.equal(cfg.webrtcEnabled, true);
    const ice = buildIceServers('org-xyz');
    assert.ok(ice.some((s) => String(s.urls).includes('stun:')));
    assert.ok(ice.some((s) => String(s.urls).includes('turn:') && s.username && s.credential));
    delete process.env.STUN_SERVERS;
    delete process.env.TURN_URLS;
    delete process.env.TURN_SECRET;
    resetLiveViewEnvCache();
  });
});
