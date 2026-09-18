/**
 * Unchanged-frame detection via cheap downsampled signature.
 * Avoids full-resolution pixel compare.
 */

/** FNV-1a 32-bit over bytes. */
export function hashBytesFnv1a(data: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Build a tiny signature from raw RGBA/RGB buffer by sampling.
 * `channels` = 3 or 4. Samples every Nth pixel into a small digest.
 */
export function frameSignatureFromRgba(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels = 4
): number {
  if (width <= 0 || height <= 0 || pixels.length === 0) return 0;
  const stepX = Math.max(1, Math.floor(width / 32));
  const stepY = Math.max(1, Math.floor(height / 32));
  const samples = new Uint8Array(32 * 32);
  let si = 0;
  for (let y = 0; y < height && si < samples.length; y += stepY) {
    for (let x = 0; x < width && si < samples.length; x += stepX) {
      const idx = (y * width + x) * channels;
      // Luma-ish
      const r = pixels[idx] ?? 0;
      const g = pixels[idx + 1] ?? 0;
      const b = pixels[idx + 2] ?? 0;
      samples[si++] = (r * 3 + g * 4 + b) >> 3;
    }
  }
  return hashBytesFnv1a(samples.subarray(0, si));
}

/** Hash JPEG/binary buffer directly (cheaper when NativeImage bitmap unavailable). */
export function frameSignatureFromBuffer(buf: Uint8Array): number {
  if (buf.length === 0) return 0;
  // Sample up to 4KB evenly across the buffer for a cheap fingerprint.
  const sample = new Uint8Array(Math.min(4096, buf.length));
  if (buf.length <= sample.length) {
    sample.set(buf);
    return hashBytesFnv1a(sample);
  }
  const step = buf.length / sample.length;
  for (let i = 0; i < sample.length; i++) {
    sample[i] = buf[Math.floor(i * step)];
  }
  return hashBytesFnv1a(sample);
}

export interface UnchangedThrottleState {
  lastHash: number | null;
  lastSentAtMs: number;
  skipped: number;
}

export function createUnchangedThrottleState(): UnchangedThrottleState {
  return { lastHash: null, lastSentAtMs: 0, skipped: 0 };
}

/**
 * Returns whether to send this frame.
 * Unchanged frames are throttled until `forceRefreshMs` elapses (keepalive).
 */
export function shouldSendFrame(
  state: UnchangedThrottleState,
  hash: number,
  nowMs: number,
  forceRefreshMs = 4000
): { send: boolean; keepalive: boolean; state: UnchangedThrottleState } {
  const unchanged = state.lastHash != null && state.lastHash === hash;
  if (!unchanged) {
    return {
      send: true,
      keepalive: false,
      state: { lastHash: hash, lastSentAtMs: nowMs, skipped: 0 },
    };
  }
  if (nowMs - state.lastSentAtMs >= forceRefreshMs) {
    return {
      send: true,
      keepalive: true,
      state: { lastHash: hash, lastSentAtMs: nowMs, skipped: state.skipped },
    };
  }
  return {
    send: false,
    keepalive: false,
    state: { ...state, skipped: state.skipped + 1 },
  };
}
