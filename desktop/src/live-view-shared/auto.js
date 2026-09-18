/**
 * Auto quality adaptation — prefers stable streaming over peak quality.
 *
 * Thresholds are documented here and overridable via LiveViewAutoConfig.
 *
 * Downgrade (High → Medium → Low) when unhealthy, with a short cooldown.
 * Upgrade (Low → Medium → High) only after a longer stable period (hysteresis).
 * On LAN P2P, prefer FPS ladder steps before resolution upgrades.
 */
import { encodeLevelIndex, stepEncodeLevel } from './quality.js';
import { maxEncodeLevelForPath, stepLanAutoFps, } from './transport-profiles.js';
export const DEFAULT_LIVE_VIEW_AUTO_CONFIG = {
    downgradeLatencyMs: 1500,
    upgradeLatencyMs: 600,
    downgradeLossRatio: 0.05,
    upgradeLossRatio: 0.01,
    downgradeBacklog: 2,
    downgradeCooldownMs: 3000,
    upgradeDelayMs: 20000,
    bitrateFloorFactor: 0.55,
};
export function createAutoControllerState(initial = 'medium', initialFps = null) {
    return {
        level: initial,
        fps: initialFps,
        healthySinceMs: null,
        lastDowngradeMs: 0,
        lastChangeMs: 0,
        lastReason: 'init',
    };
}
function isUnhealthy(sample, cfg) {
    if (sample.cpuLimited)
        return true;
    if (sample.latencyMs != null && sample.latencyMs > cfg.downgradeLatencyMs)
        return true;
    if (sample.lossRatio != null && sample.lossRatio > cfg.downgradeLossRatio)
        return true;
    if (sample.backlog != null && sample.backlog > cfg.downgradeBacklog)
        return true;
    if (sample.bitrateBps != null &&
        sample.presetMaxBitrateBps != null &&
        sample.presetMaxBitrateBps > 0 &&
        sample.bitrateBps < sample.presetMaxBitrateBps * cfg.bitrateFloorFactor) {
        return true;
    }
    return false;
}
function isHealthy(sample, cfg) {
    if (sample.cpuLimited)
        return false;
    if (sample.latencyMs != null && sample.latencyMs > cfg.upgradeLatencyMs)
        return false;
    if (sample.lossRatio != null && sample.lossRatio > cfg.upgradeLossRatio)
        return false;
    if (sample.backlog != null && sample.backlog > 0)
        return false;
    return true;
}
/**
 * Evaluate one health sample and optionally step encode level / LAN FPS.
 * Call periodically (e.g. every 1s) while mode === 'auto'.
 */
export function tickAutoQuality(state, sample, cfg = DEFAULT_LIVE_VIEW_AUTO_CONFIG, options = {}) {
    const previousLevel = state.level;
    const previousFps = state.fps;
    const next = { ...state };
    const path = options.networkPath ?? 'unknown';
    const maxLevel = options.maxLevel ?? maxEncodeLevelForPath(path);
    const lanMode = path === 'webrtc-p2p-lan';
    if (isUnhealthy(sample, cfg)) {
        next.healthySinceMs = null;
        const cooled = next.lastDowngradeMs === 0 ||
            sample.nowMs - next.lastDowngradeMs >= cfg.downgradeCooldownMs;
        if (cooled) {
            if (lanMode && next.fps != null) {
                const lowerFps = stepLanAutoFps(next.fps, -1);
                if (lowerFps != null) {
                    next.fps = lowerFps;
                    next.lastDowngradeMs = sample.nowMs;
                    next.lastChangeMs = sample.nowMs;
                    next.lastReason = sample.cpuLimited
                        ? 'cpu_fps_down'
                        : reasonForDowngrade(sample, cfg);
                    return {
                        state: next,
                        changed: true,
                        previousLevel,
                        previousFps,
                        reason: next.lastReason,
                    };
                }
            }
            if (encodeLevelIndex(next.level) > 0) {
                next.level = stepEncodeLevel(next.level, -1, maxLevel);
                if (lanMode)
                    next.fps = null; // re-resolve from preset on next push
                next.lastDowngradeMs = sample.nowMs;
                next.lastChangeMs = sample.nowMs;
                next.lastReason = sample.cpuLimited
                    ? 'cpu_level_down'
                    : reasonForDowngrade(sample, cfg);
                return {
                    state: next,
                    changed: true,
                    previousLevel,
                    previousFps,
                    reason: next.lastReason,
                };
            }
        }
        return {
            state: next,
            changed: false,
            previousLevel,
            previousFps,
            reason: next.lastReason,
        };
    }
    if (isHealthy(sample, cfg)) {
        if (next.healthySinceMs == null)
            next.healthySinceMs = sample.nowMs;
        const stableMs = sample.nowMs - next.healthySinceMs;
        if (stableMs >= cfg.upgradeDelayMs) {
            // LAN: raise FPS before resolution
            if (lanMode) {
                const baseFps = next.fps ?? 5;
                const higherFps = stepLanAutoFps(baseFps, 1);
                if (higherFps != null && next.level === 'medium') {
                    next.fps = higherFps;
                    next.lastChangeMs = sample.nowMs;
                    next.healthySinceMs = sample.nowMs;
                    next.lastReason = 'stable_fps_upgrade';
                    return {
                        state: next,
                        changed: true,
                        previousLevel,
                        previousFps,
                        reason: next.lastReason,
                    };
                }
            }
            if (encodeLevelIndex(next.level) < encodeLevelIndex(maxLevel)) {
                next.level = stepEncodeLevel(next.level, 1, maxLevel);
                if (lanMode)
                    next.fps = null;
                next.lastChangeMs = sample.nowMs;
                next.healthySinceMs = sample.nowMs;
                next.lastReason = 'stable_upgrade';
                return {
                    state: next,
                    changed: true,
                    previousLevel,
                    previousFps,
                    reason: next.lastReason,
                };
            }
        }
    }
    else {
        next.healthySinceMs = null;
    }
    return {
        state: next,
        changed: false,
        previousLevel,
        previousFps,
        reason: next.lastReason,
    };
}
function reasonForDowngrade(sample, cfg) {
    if (sample.latencyMs != null && sample.latencyMs > cfg.downgradeLatencyMs) {
        return `latency_${Math.round(sample.latencyMs)}ms`;
    }
    if (sample.lossRatio != null && sample.lossRatio > cfg.downgradeLossRatio) {
        return `loss_${(sample.lossRatio * 100).toFixed(1)}pct`;
    }
    if (sample.backlog != null && sample.backlog > cfg.downgradeBacklog) {
        return `backlog_${sample.backlog}`;
    }
    if (sample.bitrateBps != null) {
        return `bitrate_${Math.round(sample.bitrateBps)}`;
    }
    return 'unhealthy';
}
/** Merge partial env overrides into defaults. */
export function mergeAutoConfig(partial) {
    return { ...DEFAULT_LIVE_VIEW_AUTO_CONFIG, ...partial };
}
export function clampEncodeLevel(level, maxLevel = 'ultra') {
    const idx = encodeLevelIndex(level);
    const maxIdx = encodeLevelIndex(maxLevel);
    if (idx < 0)
        return 'medium';
    if (idx > maxIdx)
        return maxLevel;
    return level;
}
//# sourceMappingURL=auto.js.map