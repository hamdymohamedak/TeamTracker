/**
 * Central Live View quality presets.
 * Internet-safe defaults live here.
 * Transport-aware LAN/TURN/WS overrides live in transport-profiles.ts.
 */

export type LiveViewQualityMode = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

/** Encode levels used on the wire (Auto resolves to one of these). */
export type LiveViewEncodeLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface LiveViewQualityPreset {
  level: LiveViewEncodeLevel;
  width: number;
  jpegQuality: number;
  fps: number;
  intervalMs: number;
  /** Soft max outgoing bitrate hint for WebRTC (bps). */
  maxBitrateBps: number;
}

export const LIVE_VIEW_QUALITY_PRESETS: Record<LiveViewEncodeLevel, LiveViewQualityPreset> = {
  low: {
    level: 'low',
    width: 480,
    jpegQuality: 28,
    fps: 2,
    intervalMs: 500,
    maxBitrateBps: 250_000,
  },
  medium: {
    level: 'medium',
    width: 720,
    jpegQuality: 34,
    fps: 2.5,
    intervalMs: 400,
    maxBitrateBps: 600_000,
  },
  high: {
    level: 'high',
    width: 1280,
    jpegQuality: 45,
    fps: 3.5,
    intervalMs: 286,
    maxBitrateBps: 1_500_000,
  },
  /** LAN-only UI target; Internet/TURN/WS resolve Ultra → High via transport-profiles. */
  ultra: {
    level: 'ultra',
    width: 1280,
    jpegQuality: 45,
    fps: 3.5,
    intervalMs: 286,
    maxBitrateBps: 1_500_000,
  },
};

export const LIVE_VIEW_DEFAULT_QUALITY_MODE: LiveViewQualityMode = 'auto';

export const LIVE_VIEW_ENCODE_LEVELS: LiveViewEncodeLevel[] = ['low', 'medium', 'high', 'ultra'];

/** Internet / TURN / Binary WS Auto never steps into Ultra. */
export const LIVE_VIEW_INTERNET_ENCODE_LEVELS: LiveViewEncodeLevel[] = ['low', 'medium', 'high'];

export function isLiveViewQualityMode(value: unknown): value is LiveViewQualityMode {
  return (
    value === 'auto' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'ultra'
  );
}

export function isLiveViewEncodeLevel(value: unknown): value is LiveViewEncodeLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'ultra';
}

export function parseLiveViewQualityMode(
  value: unknown,
  fallback: LiveViewQualityMode = LIVE_VIEW_DEFAULT_QUALITY_MODE
): LiveViewQualityMode {
  return isLiveViewQualityMode(value) ? value : fallback;
}

/** Resolve UI mode to an encode preset. Auto starts at medium. */
export function resolveEncodeLevel(
  mode: LiveViewQualityMode,
  autoLevel: LiveViewEncodeLevel = 'medium'
): LiveViewEncodeLevel {
  return mode === 'auto' ? autoLevel : mode;
}

export function getQualityPreset(level: LiveViewEncodeLevel): LiveViewQualityPreset {
  return LIVE_VIEW_QUALITY_PRESETS[level];
}

export function encodeLevelIndex(level: LiveViewEncodeLevel): number {
  return LIVE_VIEW_ENCODE_LEVELS.indexOf(level);
}

export function encodeLevelByIndex(index: number): LiveViewEncodeLevel {
  const clamped = Math.max(0, Math.min(LIVE_VIEW_ENCODE_LEVELS.length - 1, index));
  return LIVE_VIEW_ENCODE_LEVELS[clamped];
}

export function stepEncodeLevel(
  level: LiveViewEncodeLevel,
  delta: -1 | 1,
  maxLevel: LiveViewEncodeLevel = 'ultra'
): LiveViewEncodeLevel {
  const maxIdx = encodeLevelIndex(maxLevel);
  const next = encodeLevelIndex(level) + delta;
  const clamped = Math.max(0, Math.min(maxIdx, next));
  return LIVE_VIEW_ENCODE_LEVELS[clamped];
}
