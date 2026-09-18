/**
 * Live View session state machine.
 * Prefer this over scattered boolean flags.
 */
const ALLOWED = {
    idle: new Set(['starting', 'stopped']),
    starting: new Set(['negotiating', 'connecting', 'fallback', 'stopping', 'failed', 'stopped']),
    negotiating: new Set(['connecting', 'reconnecting', 'fallback', 'stopping', 'failed', 'stopped']),
    connecting: new Set(['connected', 'degraded', 'reconnecting', 'fallback', 'stopping', 'failed', 'stopped']),
    connected: new Set(['degraded', 'reconnecting', 'fallback', 'stopping', 'stopped', 'failed']),
    degraded: new Set(['connected', 'reconnecting', 'fallback', 'stopping', 'stopped', 'failed']),
    reconnecting: new Set(['negotiating', 'connecting', 'connected', 'fallback', 'stopping', 'failed', 'stopped']),
    fallback: new Set(['connected', 'degraded', 'reconnecting', 'stopping', 'stopped', 'failed']),
    stopping: new Set(['stopped', 'failed']),
    stopped: new Set(['idle', 'starting']),
    failed: new Set(['idle', 'starting', 'stopped']),
};
export function canTransitionLiveView(from, to) {
    if (from === to)
        return true;
    return ALLOWED[from]?.has(to) ?? false;
}
export function transitionLiveView(from, to) {
    if (canTransitionLiveView(from, to)) {
        return { ok: true, state: to };
    }
    return { ok: false, state: from, error: `invalid_transition:${from}->${to}` };
}
export function isLiveViewActiveState(state) {
    return (state === 'starting' ||
        state === 'negotiating' ||
        state === 'connecting' ||
        state === 'connected' ||
        state === 'degraded' ||
        state === 'reconnecting' ||
        state === 'fallback');
}
//# sourceMappingURL=states.js.map