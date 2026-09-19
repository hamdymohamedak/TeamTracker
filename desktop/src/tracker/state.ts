/**
 * All mutable tracker state shared across submodules.
 *
 * Exporting a single mutable object (rather than exported `let` primitives)
 * guarantees every module reads and writes the same reference. ESM live
 * bindings only help for imported primitives reassigned via `export let`; a
 * shared object reference is simpler and works identically in CJS bundles.
 */
import { TEAMTRACKER_CONFIG, getServerUrl } from '../config.js';
import type { TrackedActivity, Config } from './types.js';

export const MAX_QUEUE = 5000;
export const QUEUE_SAVE_DEBOUNCE_MS = 2000;
export const CLOCK_SKEW_WARN_MS = 5 * 60 * 1000;
export const SYNC_BACKOFF_INITIAL_MS = 1000;
export const SYNC_BACKOFF_MAX_MS = 60_000;

export const trackerState = {
  /** In-memory activity buffer (pruned at 2000 rows). */
  activities: [] as TrackedActivity[],
  /** Pending activities not yet synced to the server. */
  offlineQueue: [] as TrackedActivity[],
  lastActivity: null as TrackedActivity | null,
  /** Latest focused window observed by the capture loop (even when not recorded). */
  currentFocus: null as { appName: string; windowTitle: string } | null,
  lastSyncTime: 0,
  isOnline: true,
  queueOverflow: false,
  queueDropCount: 0,
  queueSaveTimer: null as NodeJS.Timeout | null,
  /** serverTime - clientTime from last /api/time probe. Informational only. */
  clockOffsetMs: 0,
  quitHooksRegistered: false,
  syncBackoffMs: SYNC_BACKOFF_INITIAL_MS,
  nextSyncAllowedAt: 0,
};

export const config: Config = {
  employeeId: TEAMTRACKER_CONFIG.defaults.employeeId,
  employeeName: TEAMTRACKER_CONFIG.defaults.employeeName,
  serverUrl: getServerUrl(),
  deviceToken: TEAMTRACKER_CONFIG.deviceToken || '',
};
