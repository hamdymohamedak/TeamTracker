/**
 * Transport-aware Live View performance profiles.
 * LAN high FPS only applies on WebRTC P2P; Binary WS stays VPS-safe.
 * LAN detection is a performance signal — never a security boundary.
 */
import { LIVE_VIEW_QUALITY_PRESETS, } from './quality.js';
export const DEFAULT_LIVE_VIEW_PROFILE_CONFIG = {
    wsMaxFps: 4,
    wsMinFps: 1,
    lanMaxFps: 30,
    lanDefaultFps: 12,
    internetMaxFps: 4,
    turnMaxFps: 4,
    lanRttMaxMs: 40,
};
/** Discrete FPS choices exposed in the Dashboard per path. */
export const LAN_FPS_OPTIONS = [5, 10, 12, 15, 20, 30];
export const INTERNET_FPS_OPTIONS = [1, 2, 3, 4];
/** LAN Auto: raise FPS at 720p before bumping resolution. */
export const LAN_AUTO_FPS_LADDER = [5, 10, 12, 15];
const LAN_LEVEL_SPECS = {
    low: { width: 720, fps: 5, jpegQuality: 32, maxBitrateBps: 800000 },
    medium: { width: 720, fps: 12, jpegQuality: 36, maxBitrateBps: 2000000 },
    high: { width: 1080, fps: 18, jpegQuality: 42, maxBitrateBps: 4000000 },
    ultra: { width: 1080, fps: 30, jpegQuality: 48, maxBitrateBps: 6000000 },
};
function internetSpec(level) {
    if (level === 'ultra') {
        const high = LIVE_VIEW_QUALITY_PRESETS.high;
        return {
            width: high.width,
            fps: high.fps,
            jpegQuality: high.jpegQuality,
            maxBitrateBps: high.maxBitrateBps,
        };
    }
    const p = LIVE_VIEW_QUALITY_PRESETS[level];
    return {
        width: p.width,
        fps: p.fps,
        jpegQuality: p.jpegQuality,
        maxBitrateBps: p.maxBitrateBps,
    };
}
export function mergeProfileConfig(partial) {
    return { ...DEFAULT_LIVE_VIEW_PROFILE_CONFIG, ...partial };
}
export function isLiveViewNetworkPath(value) {
    return (value === 'webrtc-p2p-lan' ||
        value === 'webrtc-p2p-internet' ||
        value === 'webrtc-turn' ||
        value === 'binary-ws' ||
        value === 'unknown');
}
export function parseIceCandidateType(value) {
    if (value === 'host' || value === 'srflx' || value === 'prflx' || value === 'relay') {
        return value;
    }
    return 'unknown';
}
function isLanCandidateType(t) {
    return t === 'host' || t === 'prflx';
}
/**
 * Classify WebRTC route from selected ICE candidate pair.
 * Relay → TURN. host/prflx + low RTT → LAN. Otherwise Internet P2P.
 */
export function classifyIcePath(sample, lanRttMaxMs = DEFAULT_LIVE_VIEW_PROFILE_CONFIG.lanRttMaxMs) {
    if (sample.localType === 'relay' || sample.remoteType === 'relay') {
        return 'webrtc-turn';
    }
    const lanEligible = isLanCandidateType(sample.localType) && isLanCandidateType(sample.remoteType);
    const rttOk = sample.rttMs == null || sample.rttMs <= lanRttMaxMs;
    if (lanEligible && rttOk)
        return 'webrtc-p2p-lan';
    return 'webrtc-p2p-internet';
}
/**
 * Inspect RTCStatsReport-like map (browser getStats() result).
 * Accepts Map or iterable of [id, report] / forEach-capable objects.
 */
export function detectNetworkPathFromStats(stats, lanRttMaxMs = DEFAULT_LIVE_VIEW_PROFILE_CONFIG.lanRttMaxMs) {
    const byId = new Map();
    let selectedPairId;
    stats.forEach((report, id) => {
        byId.set(id, report);
        if (report.type === 'transport' && typeof report.selectedCandidatePairId === 'string') {
            selectedPairId = report.selectedCandidatePairId;
        }
    });
    let pair = null;
    if (selectedPairId && byId.has(selectedPairId)) {
        pair = byId.get(selectedPairId);
    }
    else {
        for (const report of byId.values()) {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                pair = report;
                break;
            }
        }
    }
    if (!pair) {
        return {
            path: 'unknown',
            localType: 'unknown',
            remoteType: 'unknown',
            rttMs: null,
            pairId: null,
        };
    }
    const local = pair.localCandidateId
        ? byId.get(String(pair.localCandidateId))
        : undefined;
    const remote = pair.remoteCandidateId
        ? byId.get(String(pair.remoteCandidateId))
        : undefined;
    const localType = parseIceCandidateType(local?.candidateType);
    const remoteType = parseIceCandidateType(remote?.candidateType);
    const rttMs = typeof pair.currentRoundTripTime === 'number'
        ? pair.currentRoundTripTime * 1000
        : null;
    const path = classifyIcePath({ localType, remoteType, rttMs }, lanRttMaxMs);
    return {
        path,
        localType,
        remoteType,
        rttMs,
        pairId: typeof pair.id === 'string' ? pair.id : selectedPairId || null,
    };
}
export function maxFpsForPath(path, cfg = DEFAULT_LIVE_VIEW_PROFILE_CONFIG) {
    switch (path) {
        case 'webrtc-p2p-lan':
            return cfg.lanMaxFps;
        case 'webrtc-turn':
            return cfg.turnMaxFps;
        case 'binary-ws':
            return cfg.wsMaxFps;
        case 'webrtc-p2p-internet':
        case 'unknown':
        default:
            return cfg.internetMaxFps;
    }
}
export function minFpsForPath(path, cfg = DEFAULT_LIVE_VIEW_PROFILE_CONFIG) {
    if (path === 'binary-ws')
        return cfg.wsMinFps;
    return path === 'webrtc-p2p-lan' ? 5 : cfg.wsMinFps;
}
export function allowedFpsOptions(path, cfg = DEFAULT_LIVE_VIEW_PROFILE_CONFIG) {
    const max = maxFpsForPath(path, cfg);
    const min = minFpsForPath(path, cfg);
    const base = path === 'webrtc-p2p-lan'
        ? [...LAN_FPS_OPTIONS]
        : [...INTERNET_FPS_OPTIONS];
    return base.filter((f) => f >= min && f <= max);
}
export function clampFpsForPath(fps, path, cfg = DEFAULT_LIVE_VIEW_PROFILE_CONFIG) {
    const options = allowedFpsOptions(path, cfg);
    if (options.length === 0)
        return maxFpsForPath(path, cfg);
    let best = options[0];
    let bestDist = Math.abs(fps - best);
    for (const opt of options) {
        const d = Math.abs(fps - opt);
        if (d < bestDist) {
            best = opt;
            bestDist = d;
        }
    }
    return best;
}
/** Highest encode level allowed on this path (Ultra is LAN-only). */
export function maxEncodeLevelForPath(path) {
    return path === 'webrtc-p2p-lan' ? 'ultra' : 'high';
}
export function isUltraAllowed(path) {
    return path === 'webrtc-p2p-lan';
}
function specForPath(level, path) {
    if (path === 'webrtc-p2p-lan') {
        return LAN_LEVEL_SPECS[level];
    }
    // TURN / Internet / Binary WS / unknown: Internet-safe base specs
    return internetSpec(level === 'ultra' ? 'high' : level);
}
/**
 * Resolve width/fps/bitrate for an encode level under the active network path.
 * Optional fpsOverride is clamped to path-safe options.
 */
export function resolveEffectivePreset(level, path, cfg = DEFAULT_LIVE_VIEW_PROFILE_CONFIG, fpsOverride) {
    const safeLevel = level === 'ultra' && !isUltraAllowed(path) ? 'high' : level;
    const spec = specForPath(safeLevel, path);
    const pathMax = maxFpsForPath(path, cfg);
    let fps = Math.min(spec.fps, pathMax);
    if (fpsOverride != null && Number.isFinite(fpsOverride)) {
        fps = clampFpsForPath(fpsOverride, path, cfg);
    }
    else if (path === 'webrtc-p2p-lan' && safeLevel === 'medium' && fpsOverride == null) {
        fps = clampFpsForPath(cfg.lanDefaultFps, path, cfg);
    }
    else {
        fps = clampFpsForPath(fps, path, cfg);
    }
    // Binary WS: never exceed ws max regardless of override mistakes
    if (path === 'binary-ws') {
        fps = Math.min(fps, cfg.wsMaxFps);
        fps = Math.max(fps, cfg.wsMinFps);
    }
    const intervalMs = Math.max(33, Math.round(1000 / fps));
    return {
        level: safeLevel,
        width: spec.width,
        jpegQuality: spec.jpegQuality,
        fps,
        intervalMs,
        maxBitrateBps: spec.maxBitrateBps,
        networkPath: path,
    };
}
export function effectivePresetFromInternet(level) {
    const safe = level === 'ultra' ? 'high' : level;
    return LIVE_VIEW_QUALITY_PRESETS[safe];
}
/** Next FPS on the LAN Auto ladder (or null if at top of current ladder). */
export function stepLanAutoFps(currentFps, delta) {
    const ladder = [...LAN_AUTO_FPS_LADDER];
    let idx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < ladder.length; i++) {
        const d = Math.abs(ladder[i] - currentFps);
        if (d < bestDist) {
            bestDist = d;
            idx = i;
        }
    }
    const next = idx + delta;
    if (next < 0 || next >= ladder.length)
        return null;
    return ladder[next];
}
export function networkPathLabelKey(path) {
    switch (path) {
        case 'webrtc-p2p-lan':
            return 'live.pathLan';
        case 'webrtc-p2p-internet':
            return 'live.pathInternet';
        case 'webrtc-turn':
            return 'live.pathTurn';
        case 'binary-ws':
            return 'live.pathBinary';
        default:
            return 'live.pathUnknown';
    }
}
//# sourceMappingURL=transport-profiles.js.map