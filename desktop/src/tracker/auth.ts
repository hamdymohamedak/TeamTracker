/**
 * Device-credential reset (sign-out / 401 revocation).
 *
 * Isolated from enrollment.ts and sync.ts so neither module creates a
 * circular import.  clearDeviceAuth only resets state and writes two tiny
 * files — it intentionally inlines the save logic rather than calling back
 * into enrollment.ts, because the post-clear config is trivial (no token to
 * encrypt).
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { config, trackerState } from './state.js';
import { TEAMTRACKER_CONFIG, getServerUrl, setRuntimeServerUrl } from '../config.js';
import { stopRemoteCommandClient } from '../remote.js';

export function clearDeviceAuth(reason: string): void {
  if (!config.deviceToken && !config.employeeId) return;
  console.log(`[auth] clearing device credentials (${reason})`);

  // Close presence WS first so admin shows offline immediately on sign-out
  // (otherwise the authenticated socket stays open until the app quits).
  stopRemoteCommandClient();

  config.deviceToken = '';
  config.employeeId = TEAMTRACKER_CONFIG.defaults.employeeId;
  config.employeeName = TEAMTRACKER_CONFIG.defaults.employeeName;
  config.activeProjectId = undefined;
  config.activeTaskId = undefined;
  // Reset to build/env default so local dev doesn't keep a production URL
  // (and release builds don't keep a leftover localhost URL).
  config.serverUrl = getServerUrl();
  setRuntimeServerUrl(config.serverUrl);

  // Persist a signed-out config (no token fields).
  _saveConfigAfterClear();

  // Queued rows belong to the previous identity — drop them to avoid
  // uploading under a different employee after re-enroll.
  trackerState.offlineQueue.length = 0;
  trackerState.queueOverflow = false;
  trackerState.queueDropCount = 0;
  _saveQueueEmpty();
}

/** Persist a minimal signed-out config (no token, no activeProject/Task). */
function _saveConfigAfterClear(): void {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    const toSave: Record<string, unknown> = {
      employeeId: config.employeeId,
      employeeName: config.employeeName,
      serverUrl: config.serverUrl,
    };
    fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2));
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

/** Persist an empty offline queue file after sign-out. */
function _saveQueueEmpty(): void {
  try {
    const queuePath = path.join(app.getPath('userData'), 'offline-queue.json');
    fs.writeFileSync(queuePath, JSON.stringify([], null, 2));
  } catch (err) {
    console.error('Failed to save offline queue:', err);
  }
}
