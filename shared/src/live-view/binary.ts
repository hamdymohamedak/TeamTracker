/**
 * Binary Live View frame protocol (TLV1).
 *
 * Layout (big-endian):
 *   magic u32 "TLV1" | version u8 | flags u8 | sessionUUID 16B |
 *   capturedAtMs u64 | width u16 | height u16 | payloadLen u32 | jpeg bytes
 *
 * No Base64. VPS should relay raw bytes after a cheap header peek.
 */

export const LIVE_VIEW_BINARY_MAGIC = 0x544c5631; // "TLV1"
export const LIVE_VIEW_BINARY_VERSION = 1;
export const LIVE_VIEW_BINARY_HEADER_SIZE = 4 + 1 + 1 + 16 + 8 + 2 + 2 + 4; // 38

export const LIVE_VIEW_FLAG_PRIVACY_BLOCKED = 1 << 0;
export const LIVE_VIEW_FLAG_KEEPALIVE = 1 << 1;

/** Default max JPEG payload bytes before device must re-encode smaller. */
export const LIVE_VIEW_DEFAULT_MAX_FRAME_BYTES = 220_000;

export interface LiveViewBinaryFrame {
  version: number;
  flags: number;
  sessionId: string;
  capturedAtMs: number;
  width: number;
  height: number;
  jpeg: Uint8Array;
  privacyBlocked: boolean;
  keepalive: boolean;
}

function uuidToBytes(sessionId: string): Uint8Array {
  const hex = sessionId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error('invalid session UUID');
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToUuid(bytes: Uint8Array, offset = 0): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[offset + i].toString(16).padStart(2, '0'));
  }
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function writeU64BE(view: DataView, offset: number, value: number): void {
  const hi = Math.floor(value / 0x1_0000_0000);
  const lo = value >>> 0;
  view.setUint32(offset, hi);
  view.setUint32(offset + 4, lo);
}

function readU64BE(view: DataView, offset: number): number {
  const hi = view.getUint32(offset);
  const lo = view.getUint32(offset + 4);
  return hi * 0x1_0000_0000 + lo;
}

export function encodeLiveViewBinaryFrame(input: {
  sessionId: string;
  capturedAtMs: number;
  width: number;
  height: number;
  jpeg?: Uint8Array | null;
  privacyBlocked?: boolean;
  keepalive?: boolean;
}): Uint8Array {
  const jpeg = input.jpeg ?? new Uint8Array(0);
  const flags =
    (input.privacyBlocked ? LIVE_VIEW_FLAG_PRIVACY_BLOCKED : 0) |
    (input.keepalive ? LIVE_VIEW_FLAG_KEEPALIVE : 0);

  const buf = new Uint8Array(LIVE_VIEW_BINARY_HEADER_SIZE + jpeg.length);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(0, LIVE_VIEW_BINARY_MAGIC);
  view.setUint8(4, LIVE_VIEW_BINARY_VERSION);
  view.setUint8(5, flags);
  buf.set(uuidToBytes(input.sessionId), 6);
  writeU64BE(view, 22, Math.max(0, Math.floor(input.capturedAtMs)));
  view.setUint16(30, Math.max(0, input.width | 0));
  view.setUint16(32, Math.max(0, input.height | 0));
  view.setUint32(34, jpeg.length);
  if (jpeg.length) buf.set(jpeg, LIVE_VIEW_BINARY_HEADER_SIZE);
  return buf;
}

export type DecodeBinaryResult =
  | { ok: true; frame: LiveViewBinaryFrame }
  | { ok: false; error: string };

export function peekLiveViewBinaryMagic(data: Uint8Array): boolean {
  if (data.byteLength < 4) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getUint32(0) === LIVE_VIEW_BINARY_MAGIC;
}

export function decodeLiveViewBinaryFrame(
  data: Uint8Array,
  maxFrameBytes: number = LIVE_VIEW_DEFAULT_MAX_FRAME_BYTES
): DecodeBinaryResult {
  if (data.byteLength < LIVE_VIEW_BINARY_HEADER_SIZE) {
    return { ok: false, error: 'frame_too_short' };
  }
  if (data.byteLength > LIVE_VIEW_BINARY_HEADER_SIZE + maxFrameBytes) {
    return { ok: false, error: 'frame_too_large' };
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) !== LIVE_VIEW_BINARY_MAGIC) {
    return { ok: false, error: 'bad_magic' };
  }
  const version = view.getUint8(4);
  if (version !== LIVE_VIEW_BINARY_VERSION) {
    return { ok: false, error: 'bad_version' };
  }
  const flags = view.getUint8(5);
  const sessionId = bytesToUuid(data, 6);
  const capturedAtMs = readU64BE(view, 22);
  const width = view.getUint16(30);
  const height = view.getUint16(32);
  const payloadLen = view.getUint32(34);
  if (payloadLen > maxFrameBytes) {
    return { ok: false, error: 'payload_too_large' };
  }
  if (LIVE_VIEW_BINARY_HEADER_SIZE + payloadLen !== data.byteLength) {
    return { ok: false, error: 'length_mismatch' };
  }
  const jpeg =
    payloadLen > 0
      ? data.subarray(LIVE_VIEW_BINARY_HEADER_SIZE, LIVE_VIEW_BINARY_HEADER_SIZE + payloadLen)
      : new Uint8Array(0);

  return {
    ok: true,
    frame: {
      version,
      flags,
      sessionId,
      capturedAtMs,
      width,
      height,
      jpeg,
      privacyBlocked: (flags & LIVE_VIEW_FLAG_PRIVACY_BLOCKED) !== 0,
      keepalive: (flags & LIVE_VIEW_FLAG_KEEPALIVE) !== 0,
    },
  };
}

/** Extract session UUID from a binary frame without full decode (for relay). */
export function peekBinarySessionId(data: Uint8Array): string | null {
  if (data.byteLength < LIVE_VIEW_BINARY_HEADER_SIZE) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) !== LIVE_VIEW_BINARY_MAGIC) return null;
  try {
    return bytesToUuid(data, 6);
  } catch {
    return null;
  }
}

export function peekBinaryPayloadLength(data: Uint8Array): number | null {
  if (data.byteLength < LIVE_VIEW_BINARY_HEADER_SIZE) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) !== LIVE_VIEW_BINARY_MAGIC) return null;
  return view.getUint32(34);
}
