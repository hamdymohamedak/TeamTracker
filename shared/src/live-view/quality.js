/**
 * Central Live View quality presets.
 * Internet-safe defaults live here.
 * Transport-aware LAN/TURN/WS overrides live in transport-profiles.ts.
 */
export const LIVE_VIEW_QUALITY_PRESETS = {
    low: {
        level: 'low',
        width: 480,
        jpegQuality: 28,
        fps: 2,
        intervalMs: 500,
        maxBitrateBps: 250000,
    },
    medium: {
        level: 'medium',
        width: 720,
        jpegQuality: 34,
        fps: 2.5,
        intervalMs: 400,
        maxBitrateBps: 600000,
    },
    high: {
        level: 'high',
        width: 1280,
        jpegQuality: 45,
        fps: 3.5,
        intervalMs: 286,
        maxBitrateBps: 1500000,
    },
    /** LAN-only UI target; Internet/TURN/WS resolve Ultra → High via transport-profiles. */
    ultra: {
        level: 'ultra',
        width: 1280,
        jpegQuality: 45,
        fps: 3.5,
        intervalMs: 286,
        maxBitrateBps: 1500000,
    },
};
export const LIVE_VIEW_DEFAULT_QUALITY_MODE = 'auto';
export const LIVE_VIEW_ENCODE_LEVELS = ['low', 'medium', 'high', 'ultra'];
/** Internet / TURN / Binary WS Auto never steps into Ultra. */
export const LIVE_VIEW_INTERNET_ENCODE_LEVELS = ['low', 'medium', 'high'];
export function isLiveViewQualityMode(value) {
    return (value === 'auto' ||
        value === 'low' ||
        value === 'medium' ||
        value === 'high' ||
        value === 'ultra');
}
export function isLiveViewEncodeLevel(value) {
    return value === 'low' || value === 'medium' || value === 'high' || value === 'ultra';
}
export function parseLiveViewQualityMode(value, fallback = LIVE_VIEW_DEFAULT_QUALITY_MODE) {
    return isLiveViewQualityMode(value) ? value : fallback;
}
/** Resolve UI mode to an encode preset. Auto starts at medium. */
export function resolveEncodeLevel(mode, autoLevel = 'medium') {
    return mode === 'auto' ? autoLevel : mode;
}
export function getQualityPreset(level) {
    return LIVE_VIEW_QUALITY_PRESETS[level];
}
export function encodeLevelIndex(level) {
    return LIVE_VIEW_ENCODE_LEVELS.indexOf(level);
}
export function encodeLevelByIndex(index) {
    const clamped = Math.max(0, Math.min(LIVE_VIEW_ENCODE_LEVELS.length - 1, index));
    return LIVE_VIEW_ENCODE_LEVELS[clamped];
}
export function stepEncodeLevel(level, delta, maxLevel = 'ultra') {
    const maxIdx = encodeLevelIndex(maxLevel);
    const next = encodeLevelIndex(level) + delta;
    const clamped = Math.max(0, Math.min(maxIdx, next));
    return LIVE_VIEW_ENCODE_LEVELS[clamped];
}
//# sourceMappingURL=quality.js.map