/**
 * Offline activity queue — in-memory FIFO + debounced JSON persistence.
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { trackerState, MAX_QUEUE, QUEUE_SAVE_DEBOUNCE_MS } from './state.js';
import type { TrackedActivity } from './types.js';
import { serializeQueue, deserializeQueue } from './queue-codec.js';

export { serializeQueue, deserializeQueue } from './queue-codec.js';

// ── Queue operations ──────────────────────────────────────────────────────────

/** FIFO enqueue with id-dedup, MAX_QUEUE cap, and debounced disk persist. */
export function enqueueActivity(activity: TrackedActivity): void {
  const { offlineQueue } = trackerState;
  if (activity.id && offlineQueue.some((a) => a.id === activity.id)) {
    return;
  }

  offlineQueue.push(activity);

  let droppedThisCall = 0;
  while (offlineQueue.length > MAX_QUEUE) {
    offlineQueue.shift();
    droppedThisCall++;
    trackerState.queueDropCount++;
    trackerState.queueOverflow = true;
  }
  if (droppedThisCall > 0) {
    console.warn(
      `[queue] overflow — dropped ${droppedThisCall} oldest ` +
      `(total drops: ${trackerState.queueDropCount}, cap=${MAX_QUEUE})`
    );
  }

  scheduleSaveOfflineQueue();
}

function scheduleSaveOfflineQueue(): void {
  if (trackerState.queueSaveTimer) return;
  trackerState.queueSaveTimer = setTimeout(() => {
    trackerState.queueSaveTimer = null;
    saveOfflineQueue();
  }, QUEUE_SAVE_DEBOUNCE_MS);
}

export function flushOfflineQueueToDisk(): void {
  if (trackerState.queueSaveTimer) {
    clearTimeout(trackerState.queueSaveTimer);
    trackerState.queueSaveTimer = null;
  }
  saveOfflineQueue();
}

export function registerQuitHooks(): void {
  if (trackerState.quitHooksRegistered) return;
  trackerState.quitHooksRegistered = true;
  const flush = () => {
    try { flushOfflineQueueToDisk(); } catch { /* ignore */ }
  };
  app.on('before-quit', flush);
  app.on('will-quit', flush);
}

export function loadOfflineQueue(): void {
  try {
    const queuePath = path.join(app.getPath('userData'), 'offline-queue.json');
    if (fs.existsSync(queuePath)) {
      const raw = fs.readFileSync(queuePath, 'utf-8');
      const items = deserializeQueue(raw);
      for (const item of items) {
        trackerState.offlineQueue.push(item);
      }
      while (trackerState.offlineQueue.length > MAX_QUEUE) {
        trackerState.offlineQueue.shift();
        trackerState.queueDropCount++;
        trackerState.queueOverflow = true;
      }
      console.log(`📦 Loaded ${trackerState.offlineQueue.length} queued activities from disk`);
      if (trackerState.queueOverflow) {
        console.warn(
          `[queue] loaded queue was over cap — overflow flag set (drops: ${trackerState.queueDropCount})`
        );
      }
    }
  } catch (err) {
    console.error('Failed to load offline queue:', err);
  }
}

function saveOfflineQueue(): void {
  try {
    const queuePath = path.join(app.getPath('userData'), 'offline-queue.json');
    fs.writeFileSync(queuePath, serializeQueue(trackerState.offlineQueue));
  } catch (err) {
    console.error('Failed to save offline queue:', err);
  }
}
