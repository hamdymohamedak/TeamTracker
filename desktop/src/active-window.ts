/**
 * Cross-platform active-window lookup for the TeamTracker desktop tracker.
 *
 * Strategy:
 *   1. Try `active-win` (macOS, Windows, Linux/X11).
 *   2. On Linux, if that fails or returns empty, fall back to CLI helpers:
 *        - xdotool / xprop          → X11
 *        - gdbus FocusedWindow      → GNOME Wayland (needs shell extension)
 *        - hyprctl                  → Hyprland
 *        - kdotool                  → KDE Plasma (when installed)
 *
 * Returns a normalized shape matching what the tracker already expects from
 * active-win. Never throws — callers get `null` when nothing is available.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

export interface ActiveWindowInfo {
  title: string;
  owner: {
    name: string;
    processId?: number;
  };
  platform?: string;
}

let activeWinFn: (() => Promise<any>) | null = null;
let activeWinLoadAttempted = false;
let linuxBackendLogged = false;
let lastWindow: ActiveWindowInfo | null = null;
let inFlightLookup: Promise<ActiveWindowInfo | null> | null = null;
let lastErrorLogAt = 0;
const LOOKUP_TIMEOUT_MS = 450;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    promise.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

async function loadActiveWin(): Promise<(() => Promise<any>) | null> {
  if (activeWinLoadAttempted) return activeWinFn;
  activeWinLoadAttempted = true;
  try {
    const mod = await import('active-win');
    activeWinFn = (mod as any).default || mod;
    return activeWinFn;
  } catch (err) {
    console.warn('[active-window] failed to load active-win:', (err as Error).message);
    activeWinFn = null;
    return null;
  }
}

function isLinux(): boolean {
  return process.platform === 'linux';
}

function sessionType(): 'x11' | 'wayland' | 'unknown' {
  const explicit = (process.env.XDG_SESSION_TYPE || '').toLowerCase();
  if (explicit === 'x11' || explicit === 'wayland') return explicit;
  if (process.env.WAYLAND_DISPLAY) return 'wayland';
  if (process.env.DISPLAY) return 'x11';
  return 'unknown';
}

async function runCmd(
  bin: string,
  args: string[],
  timeoutMs = 1500
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
      env: process.env
    });
    return (stdout || '').trim();
  } catch {
    return null;
  }
}

function processNameFromPid(pid: number): string | null {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    // Prefer the executable basename over the truncated /proc/<pid>/comm.
    const exe = fs.readlinkSync(`/proc/${pid}/exe`);
    const base = exe.split('/').pop();
    if (base) return base;
  } catch { /* fall through */ }
  try {
    const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf-8').trim();
    return comm || null;
  } catch {
    return null;
  }
}

/** X11 via xdotool (widely available; apt: xdotool). */
async function fromXdotool(): Promise<ActiveWindowInfo | null> {
  const id = await runCmd('xdotool', ['getactivewindow']);
  if (!id) return null;

  const [title, pidStr] = await Promise.all([
    runCmd('xdotool', ['getwindowname', id]),
    runCmd('xdotool', ['getwindowpid', id])
  ]);

  const pid = pidStr ? parseInt(pidStr, 10) : NaN;
  const name = processNameFromPid(pid) || 'Unknown';

  return {
    title: title || 'Untitled',
    owner: { name, processId: Number.isFinite(pid) ? pid : undefined },
    platform: 'linux'
  };
}

/** X11 via xprop as a lighter fallback when xdotool isn't installed. */
async function fromXprop(): Promise<ActiveWindowInfo | null> {
  const root = await runCmd('xprop', ['-root', '_NET_ACTIVE_WINDOW']);
  if (!root) return null;
  const match = root.match(/0x[0-9a-fA-F]+/);
  if (!match) return null;
  const wid = match[0];

  const [titleOut, pidOut, wmClassOut] = await Promise.all([
    runCmd('xprop', ['-id', wid, 'WM_NAME', '_NET_WM_NAME']),
    runCmd('xprop', ['-id', wid, '_NET_WM_PID']),
    runCmd('xprop', ['-id', wid, 'WM_CLASS'])
  ]);

  let title = 'Untitled';
  if (titleOut) {
    // Prefer UTF8 _NET_WM_NAME, then WM_NAME.
    const net = titleOut.match(/_NET_WM_NAME\(UTF8_STRING\)\s*=\s*"((?:\\.|[^"\\])*)"/);
    const wm = titleOut.match(/WM_NAME\([^)]*\)\s*=\s*"((?:\\.|[^"\\])*)"/);
    const raw = (net?.[1] ?? wm?.[1] ?? '').replace(/\\"/g, '"');
    if (raw) title = raw;
  }

  let pid: number | undefined;
  if (pidOut) {
    const m = pidOut.match(/=\s*(\d+)/);
    if (m) pid = parseInt(m[1], 10);
  }

  let name = pid ? processNameFromPid(pid) : null;
  if (!name && wmClassOut) {
    // WM_CLASS(STRING) = "instance", "Class"
    const classes = [...wmClassOut.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(m => m[1]);
    name = classes[1] || classes[0] || null;
  }

  return {
    title,
    owner: { name: name || 'Unknown', processId: pid },
    platform: 'linux'
  };
}

/**
 * GNOME Wayland via the "Focused Window D-Bus" extension
 * (https://extensions.gnome.org/extension/5592/focused-window-d-bus).
 * Returns JSON with title / wm_class / pid.
 */
async function fromGnomeFocusedWindow(): Promise<ActiveWindowInfo | null> {
  const out = await runCmd('gdbus', [
    'call',
    '--session',
    '--dest', 'org.gnome.Shell',
    '--object-path', '/org/gnome/shell/extensions/FocusedWindow',
    '--method', 'org.gnome.shell.extensions.FocusedWindow.Get'
  ], 2000);

  if (!out) return null;

  // gdbus wraps the reply as: ({'title': '...', ...},) or ("{...json...}",)
  let jsonText = out.trim();
  // Strip trailing ",)" / ")" tuple wrappers from gdbus.
  if (jsonText.startsWith("('") || jsonText.startsWith('("')) {
    const end = jsonText.lastIndexOf("'") > jsonText.lastIndexOf('"')
      ? jsonText.lastIndexOf("'")
      : jsonText.lastIndexOf('"');
    jsonText = jsonText.slice(2, end);
    // gdbus escapes quotes as \'
    jsonText = jsonText.replace(/\\'/g, "'").replace(/\\"/g, '"');
  } else if (jsonText.startsWith('({') && jsonText.endsWith('},)')) {
    // Native gvariant dict — not JSON. Bail; extension usually returns a string.
    return null;
  } else {
    // Sometimes the whole thing is already a JSON string wrapped in quotes.
    const m = jsonText.match(/\{[\s\S]*\}/);
    if (!m) return null;
    jsonText = m[0];
  }

  try {
    const data = JSON.parse(jsonText) as {
      title?: string;
      wm_class?: string;
      wm_class_instance?: string;
      pid?: number;
    };
    const pid = typeof data.pid === 'number' ? data.pid : undefined;
    const name =
      (pid ? processNameFromPid(pid) : null) ||
      data.wm_class ||
      data.wm_class_instance ||
      'Unknown';
    return {
      title: data.title || 'Untitled',
      owner: { name, processId: pid },
      platform: 'linux'
    };
  } catch {
    return null;
  }
}

/** Hyprland Wayland compositor. */
async function fromHyprctl(): Promise<ActiveWindowInfo | null> {
  const out = await runCmd('hyprctl', ['activewindow', '-j']);
  if (!out) return null;
  try {
    const data = JSON.parse(out) as {
      title?: string;
      class?: string;
      pid?: number;
    };
    if (!data.title && !data.class) return null;
    const pid = typeof data.pid === 'number' ? data.pid : undefined;
    const name =
      (pid ? processNameFromPid(pid) : null) || data.class || 'Unknown';
    return {
      title: data.title || 'Untitled',
      owner: { name, processId: pid },
      platform: 'linux'
    };
  } catch {
    return null;
  }
}

/** KDE Plasma when kdotool is installed (xdotool-compatible for KWin). */
async function fromKdotool(): Promise<ActiveWindowInfo | null> {
  const title = await runCmd('kdotool', ['getactivewindow', 'getwindowname']);
  if (title === null) return null;
  const pidStr = await runCmd('kdotool', ['getactivewindow', 'getwindowpid']);
  const pid = pidStr ? parseInt(pidStr, 10) : NaN;
  const name = processNameFromPid(pid) || 'Unknown';
  return {
    title: title || 'Untitled',
    owner: { name, processId: Number.isFinite(pid) ? pid : undefined },
    platform: 'linux'
  };
}

async function fromLinuxFallbacks(): Promise<ActiveWindowInfo | null> {
  const session = sessionType();

  // Prefer compositor-specific tools on Wayland; X11 tools first on X11.
  const order: Array<() => Promise<ActiveWindowInfo | null>> =
    session === 'wayland'
      ? [fromGnomeFocusedWindow, fromHyprctl, fromKdotool, fromXdotool, fromXprop]
      : [fromXdotool, fromXprop, fromGnomeFocusedWindow, fromHyprctl, fromKdotool];

  for (const fn of order) {
    try {
      const info = await fn();
      if (info && (info.title !== 'Unknown' || info.owner.name !== 'Unknown')) {
        if (!linuxBackendLogged) {
          console.log(`[active-window] Linux backend: ${fn.name} (${session})`);
          linuxBackendLogged = true;
        }
        return info;
      }
    } catch {
      // try next
    }
  }

  if (!linuxBackendLogged) {
    console.warn(
      `[active-window] No Linux window backend available (session=${session}). ` +
      'On X11 install xdotool. On GNOME Wayland install the Focused Window D-Bus extension. ' +
      'On Hyprland ensure hyprctl is on PATH. On KDE install kdotool.'
    );
    linuxBackendLogged = true;
  }
  return null;
}

function normalizeActiveWin(raw: any): ActiveWindowInfo | null {
  if (!raw) return null;
  const title = raw.title || 'Untitled';
  const name =
    raw.owner?.name ||
    raw.owner?.bundleId ||
    raw.owner?.path?.split(/[\\/]/).pop() ||
    'Unknown';
  return {
    title,
    owner: {
      name,
      processId: typeof raw.owner?.processId === 'number' ? raw.owner.processId : undefined
    },
    platform: raw.platform
  };
}

/**
 * Resolve the currently focused window. Safe to call frequently —
 * concurrent callers share one in-flight lookup, results are cached briefly,
 * and slow/failing backends time out instead of hanging the live stream.
 */
export async function getActiveWindow(): Promise<ActiveWindowInfo | null> {
  if (inFlightLookup) return inFlightLookup;

  inFlightLookup = (async () => {
    try {
      const fn = await loadActiveWin();
      if (fn) {
        try {
          const raw = await withTimeout(Promise.resolve().then(() => fn()), LOOKUP_TIMEOUT_MS);
          const normalized = normalizeActiveWin(raw);
          if (normalized && (normalized.title || normalized.owner.name !== 'Unknown')) {
            lastWindow = normalized;
            return normalized;
          }
        } catch (err) {
          const now = Date.now();
          if (!isLinux() && now - lastErrorLogAt > 10_000) {
            lastErrorLogAt = now;
            console.warn('[active-window] active-win error:', (err as Error).message);
          }
          if (!isLinux()) return lastWindow;
        }
      }

      if (isLinux()) {
        const linux = await withTimeout(fromLinuxFallbacks(), LOOKUP_TIMEOUT_MS);
        if (linux) {
          lastWindow = linux;
          return linux;
        }
      }

      return lastWindow;
    } finally {
      inFlightLookup = null;
    }
  })();

  return inFlightLookup;
}

/** Whether the active-win native module loaded (useful for status logs). */
export async function hasActiveWinModule(): Promise<boolean> {
  return !!(await loadActiveWin());
}
