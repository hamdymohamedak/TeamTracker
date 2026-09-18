/**
 * Device enrollment, config persistence, and auth identity management.
 *
 * startPresenceClient() and syncClockSkew() are intentionally NOT called
 * here — the ipc.ts handler and index.ts orchestrate those after enrollment
 * so that enrollment.ts has no imports from sync.ts or capture-loop.ts,
 * keeping the dependency graph acyclic.
 */
import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { config, trackerState } from './state.js';
import { TEAMTRACKER_CONFIG, getServerUrl, setRuntimeServerUrl } from '../config.js';
import { clearDeviceAuth } from './auth.js';

export function syncRuntimeServerUrl(): void {
  setRuntimeServerUrl(config.serverUrl || getServerUrl());
}

export function loadConfig(): void {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      // Prefer safeStorage-encrypted token when available.
      if (saved.deviceTokenEnc && typeof saved.deviceTokenEnc === 'string') {
        try {
          if (safeStorage.isEncryptionAvailable()) {
            saved.deviceToken = safeStorage.decryptString(
              Buffer.from(saved.deviceTokenEnc, 'base64')
            );
          } else {
            console.warn('[config] encrypted token present but safeStorage unavailable');
          }
        } catch (err) {
          console.error('[config] failed to decrypt device token:', (err as Error).message);
        }
        delete saved.deviceTokenEnc;
      }
      // Never log token material from saved config.
      Object.assign(config, saved);
      if (config.serverUrl) {
        config.serverUrl = config.serverUrl.replace(/\/+$/, '');
      }
      // Not enrolled yet: ignore a stale saved serverUrl from a previous
      // production/local session so `pnpm run dev` always defaults to localhost
      // and release builds default to production.
      if (!config.deviceToken) {
        config.serverUrl = getServerUrl();
      }
      syncRuntimeServerUrl();
    }
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

export function saveConfig(): void {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    const toSave: Record<string, unknown> = {
      employeeId: config.employeeId,
      employeeName: config.employeeName,
      serverUrl: config.serverUrl,
    };
    if (config.activeProjectId) toSave.activeProjectId = config.activeProjectId;
    if (config.activeTaskId) toSave.activeTaskId = config.activeTaskId;

    if (config.deviceToken) {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          toSave.deviceTokenEnc = safeStorage
            .encryptString(config.deviceToken)
            .toString('base64');
        } else {
          // Linux without keyring / encryption unavailable — plaintext fallback.
          toSave.deviceToken = config.deviceToken;
        }
      } catch {
        toSave.deviceToken = config.deviceToken;
      }
    }
    // When signed out, omit token fields so a previous deviceTokenEnc is not
    // reloaded on next launch.

    fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2));
  } catch (err) {
    console.error('Failed to save config:', err);
  }
}

function tryDeleteFile(p: string): void {
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}

/**
 * First-run activation: look for a `teamtracker-activate*.json` file in the
 * user's Downloads folder, redeem the setup token against /api/auth/enroll,
 * and persist the returned device JWT + employee info into config.json.
 *
 * Safe to call every startup — it only runs if `config.deviceToken` is empty.
 * Returns `true` if activation succeeded, `false` otherwise. Never throws.
 */
export async function activateFromDownloadsIfNeeded(): Promise<boolean> {
  // Already have a device token — skip.
  if (config.deviceToken) return false;

  let downloadsDir: string;
  try {
    downloadsDir = app.getPath('downloads');
  } catch {
    return false; // No downloads path on this platform — bail out silently.
  }

  if (!fs.existsSync(downloadsDir)) return false;

  // Find all teamtracker-activate*.json files, pick the newest by mtime.
  let matches: { path: string; mtimeMs: number }[] = [];
  try {
    const entries = fs.readdirSync(downloadsDir);
    for (const name of entries) {
      if (!name.startsWith('teamtracker-activate') || !name.endsWith('.json')) continue;
      const full = path.join(downloadsDir, name);
      try {
        const stat = fs.statSync(full);
        if (stat.isFile()) matches.push({ path: full, mtimeMs: stat.mtimeMs });
      } catch { /* ignore unreadable entries */ }
    }
  } catch (err) {
    console.warn('[activate] could not scan Downloads:', (err as Error).message);
    return false;
  }

  if (matches.length === 0) return false;

  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const target = matches[0].path;

  let payload: { setupToken?: string; token?: string; serverUrl?: string } = {};
  try {
    payload = JSON.parse(fs.readFileSync(target, 'utf-8'));
  } catch (err) {
    console.error('[activate] failed to parse activation file:', (err as Error).message);
    tryDeleteFile(target);
    return false;
  }

  const setupToken = payload.setupToken || payload.token;
  const serverUrl = (payload.serverUrl || config.serverUrl || '').replace(/\/+$/, '');

  if (!setupToken || !serverUrl) {
    console.error('[activate] activation file missing setupToken or serverUrl');
    tryDeleteFile(target);
    return false;
  }

  console.log(`[activate] found activation file, enrolling against ${serverUrl}...`);

  try {
    const resp = await fetch(`${serverUrl}/api/auth/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken })
    });
    const data: any = await resp.json().catch(() => ({}));

    if (!resp.ok || !data?.success || !data?.data?.accessToken) {
      const reason = data?.error || `HTTP ${resp.status}`;
      console.error(`[activate] enrollment rejected: ${reason}`);
      tryDeleteFile(target); // Stale/invalid token — don't retry on every launch.
      return false;
    }

    // Success — persist everything.
    config.deviceToken = data.data.accessToken;
    config.employeeId = data.data.employeeId;
    config.employeeName = data.data.employeeName;
    config.serverUrl = serverUrl;
    syncRuntimeServerUrl();
    saveConfig();

    // Clean up ALL activation files so stale ones don't linger.
    for (const m of matches) tryDeleteFile(m.path);

    console.log(`[activate] ✓ activated as ${data.data.employeeName} (${data.data.employeeId})`);
    // Note: syncClockSkew() is called by startTracking() immediately after
    // this function returns, so we do not fire it again here.
    return true;
  } catch (err) {
    console.error('[activate] network error during enrollment:', (err as Error).message);
    // Leave the file in place — this is likely a transient offline state;
    // the next launch will retry.
    return false;
  }
}

export async function enrollWithSetupToken(
  setupToken: string,
  serverUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const url = (serverUrl || config.serverUrl || getServerUrl()).replace(/\/+$/, '');
  if (!setupToken?.trim()) {
    return { success: false, error: 'Setup token is required' };
  }
  if (!url) {
    return { success: false, error: 'Server URL is required' };
  }

  try {
    const resp = await fetch(`${url}/api/auth/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken: setupToken.trim() })
    });
    const data: any = await resp.json().catch(() => ({}));

    if (!resp.ok || !data?.success || !data?.data?.accessToken) {
      return { success: false, error: data?.error || `Enrollment failed (HTTP ${resp.status})` };
    }

    config.deviceToken = data.data.accessToken;
    config.employeeId = data.data.employeeId;
    config.employeeName = data.data.employeeName;
    config.serverUrl = url;
    syncRuntimeServerUrl();
    saveConfig();

    console.log(`[enroll] ✓ connected as ${data.data.employeeName} (${data.data.employeeId})`);
    trackerState.isOnline = true;
    // Callers (ipc.ts) are responsible for re-opening the presence WS and
    // probing the clock after a successful enroll.
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message || 'Network error' };
  }
}

export function isEnrolled(): boolean {
  return !!config.deviceToken;
}

/**
 * Sign out this device: drop the device JWT and employee identity so the
 * employee can re-enroll with a new setup token.
 */
export function logoutDevice(): { success: boolean } {
  clearDeviceAuth('user signed out');
  return { success: true };
}
