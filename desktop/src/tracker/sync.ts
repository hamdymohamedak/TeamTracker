/**
 * Server synchronisation: activity batch upload, online-status polling, and
 * clock-skew probing.
 *
 * Dependency graph: sync → state, config, auth, offline-queue (no circular).
 */
import { config, trackerState, CLOCK_SKEW_WARN_MS, SYNC_BACKOFF_INITIAL_MS, SYNC_BACKOFF_MAX_MS } from './state.js';
import { getEffectiveServerUrl } from '../config.js';
import { clearDeviceAuth } from './auth.js';
import { flushOfflineQueueToDisk } from './offline-queue.js';

/**
 * Probe server clock. Stores clockOffsetMs for diagnostics via getStatus.
 * Does NOT rewrite activity timestamps — offset is informational for admins.
 */
export async function syncClockSkew(): Promise<void> {
  const serverUrl = getEffectiveServerUrl();
  const token = config.deviceToken;
  if (!token || !serverUrl) return;

  const clientTime = Date.now();
  try {
    const res = await fetch(`${serverUrl}/api/time?clientTime=${clientTime}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    const json: any = await res.json().catch(() => null);
    const offset = json?.data?.clockOffsetMs;
    if (typeof offset !== 'number' || !Number.isFinite(offset)) return;

    trackerState.clockOffsetMs = offset;
    if (Math.abs(offset) > CLOCK_SKEW_WARN_MS) {
      console.warn(
        `[clock] skew |offset|=${Math.round(Math.abs(offset) / 1000)}s ` +
        `(${offset > 0 ? 'client behind server' : 'client ahead of server'}) — ` +
        `activity timestamps are NOT rewritten`
      );
    }
  } catch (err) {
    console.warn('[clock] time probe failed:', (err as Error).message);
  }
}

export async function syncToServer(): Promise<void> {
  const { offlineQueue } = trackerState;
  if (offlineQueue.length === 0) return;

  if (Date.now() < trackerState.nextSyncAllowedAt) {
    return;
  }

  if (!trackerState.isOnline) {
    console.log(`📴 Offline - ${offlineQueue.length} activities queued for later`);
    flushOfflineQueueToDisk();
    return;
  }

  // Process in batches of 50 to avoid payload-too-large (FIFO from front).
  const BATCH_SIZE = 50;
  let totalSynced = 0;
  let totalSuspicious = 0;

  while (offlineQueue.length > 0) {
    if (Date.now() < trackerState.nextSyncAllowedAt) break;

    const batchSize = Math.min(BATCH_SIZE, offlineQueue.length);
    const batch = offlineQueue.splice(0, batchSize);

    try {
      const payload = {
        employeeId: config.employeeId,
        activities: batch.map(a => ({
          id: a.id,
          timestamp: a.timestamp,
          appName: a.appName,
          windowTitle: a.windowTitle,
          category: a.category,
          categoryName: a.categoryName,
          productivityScore: a.productivityScore,
          productivityLevel: a.productivityLevel,
          isSuspicious: a.isSuspicious,
          suspiciousReason: a.suspiciousReason,
          isIdle: a.isIdle,
          idleTimeSeconds: a.idleTimeSeconds,
          durationSeconds: a.durationSeconds,
          ...(config.activeProjectId ? { projectId: config.activeProjectId } : {}),
          ...(config.activeTaskId ? { taskId: config.activeTaskId } : {}),
        }))
      };

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.deviceToken) {
        headers['Authorization'] = `Bearer ${config.deviceToken}`;
      }
      console.log(
        `Sync: token=${config.deviceToken ? 'yes' : 'no'}, ` +
        `url=${getEffectiveServerUrl()}, ` +
        `authHeader=${headers['Authorization'] ? 'set' : 'MISSING'}`
      );

      const response = await fetch(`${getEffectiveServerUrl()}/api/activity`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const body = await response.text();
        console.log(`Sync response: ${response.status} ${response.statusText} - ${body}`);
      }

      if (response.ok) {
        const result: any = await response.json();
        totalSynced += batch.length;
        totalSuspicious += result.data?.suspiciousCount || 0;
        trackerState.syncBackoffMs = SYNC_BACKOFF_INITIAL_MS;
        trackerState.nextSyncAllowedAt = 0;
      } else if (response.status === 401) {
        // Revoked / inactive employee / expired legacy token — clear local auth
        // so the employee UI returns to setup.
        console.error('Device access revoked or invalid. Please re-enroll with a new setup token.');
        offlineQueue.unshift(...batch);
        clearDeviceAuth('sync received HTTP 401');
        trackerState.isOnline = false;
        break;
      } else if (response.status === 429) {
        offlineQueue.unshift(...batch);
        trackerState.nextSyncAllowedAt = Date.now() + trackerState.syncBackoffMs;
        console.warn(`[sync] rate limited — retry in ${trackerState.syncBackoffMs}ms`);
        trackerState.syncBackoffMs = Math.min(trackerState.syncBackoffMs * 2, SYNC_BACKOFF_MAX_MS);
        break;
      } else if (response.status >= 400 && response.status < 500) {
        // Non-retryable client error — drop this batch (do not poison the queue).
        console.warn(
          `[sync] dropping ${batch.length} activities due to HTTP ${response.status} (non-retryable 4xx)`
        );
        flushOfflineQueueToDisk();
        // continue with remaining FIFO items
      } else {
        // 5xx / other — requeue and back off.
        offlineQueue.unshift(...batch);
        trackerState.nextSyncAllowedAt = Date.now() + trackerState.syncBackoffMs;
        console.error(`[sync] failed (${response.status}) — retry in ${trackerState.syncBackoffMs}ms`);
        trackerState.syncBackoffMs = Math.min(trackerState.syncBackoffMs * 2, SYNC_BACKOFF_MAX_MS);
        break;
      }
    } catch (err) {
      offlineQueue.unshift(...batch);
      trackerState.isOnline = false;
      trackerState.nextSyncAllowedAt = Date.now() + trackerState.syncBackoffMs;
      console.error(`[sync] network error — retry in ${trackerState.syncBackoffMs}ms:`, err);
      trackerState.syncBackoffMs = Math.min(trackerState.syncBackoffMs * 2, SYNC_BACKOFF_MAX_MS);
      flushOfflineQueueToDisk();
      break;
    }
  }

  if (totalSynced > 0) {
    console.log(`✓ Synced ${totalSynced} activities`);
    if (totalSuspicious > 0) {
      console.warn(`⚠️ Server flagged ${totalSuspicious} suspicious activities`);
    }
    trackerState.lastSyncTime = Date.now();
    flushOfflineQueueToDisk();
  }
}

export async function checkOnlineStatus(): Promise<void> {
  try {
    const response = await fetch(`${getEffectiveServerUrl()}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    const wasOffline = !trackerState.isOnline;
    trackerState.isOnline = response.ok;

    if (wasOffline && trackerState.isOnline && trackerState.offlineQueue.length > 0) {
      console.log('🌐 Back online - syncing queued activities...');
      trackerState.syncBackoffMs = SYNC_BACKOFF_INITIAL_MS;
      trackerState.nextSyncAllowedAt = 0;
      syncToServer();
    }
  } catch {
    trackerState.isOnline = false;
  }
}
