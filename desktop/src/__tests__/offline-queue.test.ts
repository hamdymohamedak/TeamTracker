/**
 * Unit tests for offline-queue serialization/deserialization.
 *
 * These tests only exercise the pure functions (serializeQueue /
 * deserializeQueue) which have no Electron dependency and can run in plain
 * Node.js via tsx.
 *
 * Run: cd desktop && pnpm test
 * Or:  cd desktop && npx tsx --test src/__tests__/offline-queue.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { serializeQueue, deserializeQueue } from '../tracker/queue-codec.js';

// Minimal TrackedActivity stub — only the fields that serialization touches.
const makeActivity = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  timestamp: '2026-01-01T10:00:00.000Z',
  appName: 'TestApp',
  windowTitle: 'Test Window',
  category: 'core_work' as const,
  categoryName: 'Core Work',
  productivityScore: 80,
  productivityLevel: 'productive' as const,
  isSuspicious: false,
  suspiciousReason: undefined,
  isIdle: false,
  idleTimeSeconds: 0,
  durationSeconds: 30,
  hasInputActivity: true,
  ...overrides,
});

describe('serializeQueue', () => {
  it('returns a parseable JSON string', () => {
    const queue = [makeActivity('a1'), makeActivity('a2')];
    const json = serializeQueue(queue);
    const parsed = JSON.parse(json);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].id, 'a1');
    assert.equal(parsed[1].id, 'a2');
  });

  it('serializes an empty array', () => {
    assert.equal(serializeQueue([]), '[]');
  });

  it('round-trips preserving all fields', () => {
    const original = makeActivity('rt1', { suspiciousReason: 'test reason', isIdle: true });
    const [recovered] = JSON.parse(serializeQueue([original]));
    assert.equal(recovered.id, 'rt1');
    assert.equal(recovered.suspiciousReason, 'test reason');
    assert.equal(recovered.isIdle, true);
  });
});

describe('deserializeQueue', () => {
  it('parses a valid JSON array', () => {
    const input = JSON.stringify([makeActivity('d1'), makeActivity('d2')]);
    const result = deserializeQueue(input);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'd1');
  });

  it('deduplicates entries with identical ids (keeps first)', () => {
    const a = makeActivity('dup', { appName: 'First' });
    const b = makeActivity('dup', { appName: 'Second' });
    const result = deserializeQueue(JSON.stringify([a, b]));
    assert.equal(result.length, 1);
    assert.equal(result[0].appName, 'First');
  });

  it('returns an empty array for an empty JSON array', () => {
    assert.deepEqual(deserializeQueue('[]'), []);
  });

  it('returns an empty array for malformed JSON', () => {
    assert.deepEqual(deserializeQueue('not json'), []);
  });

  it('returns an empty array for a non-array JSON value', () => {
    assert.deepEqual(deserializeQueue('"just a string"'), []);
    assert.deepEqual(deserializeQueue('{}'), []);
    assert.deepEqual(deserializeQueue('42'), []);
  });

  it('handles items without an id field without dedup errors', () => {
    const noId = { appName: 'NoId', timestamp: '2026-01-01T00:00:00Z' };
    const withId = makeActivity('wid1');
    const result = deserializeQueue(JSON.stringify([noId, withId]));
    assert.equal(result.length, 2);
  });
});

describe('serialize → deserialize round-trip', () => {
  it('recovers the exact queue after a write/read cycle', () => {
    const queue = [
      makeActivity('rt-a', { productivityScore: 95, durationSeconds: 60 }),
      makeActivity('rt-b', { isIdle: true, idleTimeSeconds: 120 }),
    ];
    const recovered = deserializeQueue(serializeQueue(queue));
    assert.equal(recovered.length, 2);
    assert.equal(recovered[0].productivityScore, 95);
    assert.equal(recovered[1].idleTimeSeconds, 120);
  });

  it('dedup survives a round-trip', () => {
    const a = makeActivity('dup2', { appName: 'Alpha' });
    const b = makeActivity('dup2', { appName: 'Beta' });
    const serialized = serializeQueue([a, b]);
    const recovered = deserializeQueue(serialized);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].appName, 'Alpha');
  });
});
