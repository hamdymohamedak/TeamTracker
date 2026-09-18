/**
 * Electron IPC handler registration for all `tracker:*` channels.
 *
 * After a successful enroll this module re-opens the presence WebSocket and
 * probes the server clock — behaviour previously inline in enrollWithSetupToken
 * but moved here to keep enrollment.ts free of sync/capture-loop imports.
 */
import { ipcMain } from 'electron';
import { config, trackerState } from './state.js';
import { getServerUrl } from '../config.js';
import {
  enrollWithSetupToken,
  logoutDevice,
  saveConfig,
  syncRuntimeServerUrl,
} from './enrollment.js';
import { syncClockSkew, syncToServer } from './sync.js';
import { startPresenceClient } from './capture-loop.js';
import { generateDailySummary } from '../classifier.js';
import { getCapturePrivacyBlocks, getPrivacyUrlMode } from '../privacy-guard.js';
import { getShowPrivacyBlocksToEmployees } from '../screenshot.js';
import type { Config } from './types.js';

export function setupIpcHandlers(): void {
  ipcMain.handle('tracker:getStatus', () => {
    const showPrivacy = getShowPrivacyBlocksToEmployees();
    const privacyPatterns = showPrivacy
      ? [...new Set(getCapturePrivacyBlocks().map(b => b.appPattern).filter(Boolean))]
      : [];
    return {
      isOnline: trackerState.isOnline,
      activitiesCount: trackerState.activities.length,
      queuedCount: trackerState.offlineQueue.length,
      queueOverflow: trackerState.queueOverflow,
      queueDropCount: trackerState.queueDropCount,
      clockOffsetMs: trackerState.clockOffsetMs,
      lastActivity: trackerState.lastActivity,
      showPrivacyBlocksToEmployees: showPrivacy,
      privacyUrlMode: getPrivacyUrlMode(),
      privacyProtectedSites: privacyPatterns,
      config: {
        ...config,
        deviceToken: config.deviceToken ? '***' : '',
        // Never expose server URL to the employee UI status surface.
        serverUrl: undefined,
        activeProjectId: config.activeProjectId,
        activeTaskId: config.activeTaskId,
      },
      // Setup form only — prefilled default, not shown after enroll.
      defaultServerUrl: config.serverUrl || getServerUrl(),
    };
  });

  ipcMain.handle('tracker:enroll', async (_, setupToken: string, serverUrl?: string) => {
    const result = await enrollWithSetupToken(setupToken, serverUrl);
    if (result.success) {
      // Re-open presence WS after sign-out (or first enroll while app is running).
      startPresenceClient();
      void syncClockSkew();
      // Flush anything queued while offline / before auth.
      Promise.resolve().then(() => syncToServer()).catch(() => { /* ignore */ });
    }
    return result;
  });

  ipcMain.handle('tracker:logout', () => logoutDevice());

  ipcMain.handle('tracker:getStats', () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayActivities = trackerState.activities
      .filter(a => new Date(a.timestamp) >= today)
      .map(a => ({
        category: a.category,
        duration: a.durationSeconds,
        isIdle: a.isIdle,
        isSuspicious: a.isSuspicious,
        appName: a.appName,
        windowTitle: a.windowTitle
      }));

    return generateDailySummary(config.employeeId, todayActivities);
  });

  ipcMain.handle('tracker:getRecentActivities', () => {
    return trackerState.activities.slice(-50).reverse();
  });

  ipcMain.handle('tracker:updateConfig', (_, newConfig: Partial<Config>) => {
    // Never accept/log raw token dumps from renderer beyond assignment.
    const { deviceToken: _ignored, ...safe } = newConfig as Partial<Config> & { deviceToken?: string };
    void _ignored;
    Object.assign(config, safe);
    // Allow explicit project/task clear via nullish empty string.
    if ('activeProjectId' in newConfig) {
      config.activeProjectId = newConfig.activeProjectId || undefined;
    }
    if ('activeTaskId' in newConfig) {
      config.activeTaskId = newConfig.activeTaskId || undefined;
    }
    if (config.serverUrl) {
      config.serverUrl = String(config.serverUrl).replace(/\/+$/, '');
    }
    syncRuntimeServerUrl();
    saveConfig();
    return {
      ...config,
      deviceToken: config.deviceToken ? '***' : '',
    };
  });

  ipcMain.handle('tracker:setActiveProjectTask', (_, projectId?: string, taskId?: string) => {
    config.activeProjectId = projectId || undefined;
    config.activeTaskId = taskId || undefined;
    saveConfig();
    return { activeProjectId: config.activeProjectId, activeTaskId: config.activeTaskId };
  });
}
