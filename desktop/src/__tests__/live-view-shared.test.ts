import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  frameSignatureFromBuffer,
  shouldSendFrame,
  createUnchangedThrottleState,
  getQualityPreset,
  resolveEncodeLevel,
  resolveEffectivePreset,
  allowedFpsOptions,
  classifyIcePath,
} from '../live-view-shared/index.js';

describe('desktop live-view shared presets', () => {
  it('resolves auto to medium and exposes intervals', () => {
    assert.equal(resolveEncodeLevel('auto'), 'medium');
    assert.ok(getQualityPreset('low').intervalMs >= 400);
  });

  it('mirrors transport profile LAN vs WS clamps', () => {
    assert.equal(classifyIcePath({ localType: 'host', remoteType: 'host', rttMs: 5 }), 'webrtc-p2p-lan');
    const lan = resolveEffectivePreset('medium', 'webrtc-p2p-lan');
    const ws = resolveEffectivePreset('medium', 'binary-ws', undefined, 30);
    assert.ok(lan.fps >= 10);
    assert.ok(ws.fps <= 4);
    assert.ok(!allowedFpsOptions('binary-ws').includes(30));
  });
});

describe('desktop unchanged throttle', () => {
  it('throttles static screen signatures', () => {
    const hash = frameSignatureFromBuffer(new Uint8Array(64).fill(7));
    let state = createUnchangedThrottleState();
    let r = shouldSendFrame(state, hash, 0, 2000);
    assert.equal(r.send, true);
    state = r.state;
    r = shouldSendFrame(state, hash, 500, 2000);
    assert.equal(r.send, false);
  });
});
