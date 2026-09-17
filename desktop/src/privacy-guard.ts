/**
 * PrivacyGuard — centralized capture gate for screenshots and live view.
 *
 * Flow: BrowserDetection → URL normalization → host match → decide(purpose)
 *   → ALLOW | BLOCK | UNKNOWN
 *
 * URL rules match the **active tab** of each browser window only (not background tabs).
 * Fail-safe: when URL rules exist and browser state cannot be verified,
 * decide() returns UNKNOWN and capture adapters must not grab/transmit pixels.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { desktopCapturer } from 'electron';
import { getActiveWindow } from './active-window.js';
import {
  type BrowserProbeResult,
  type CapturePrivacyBlock,
  type PrivacyDecision,
  type PrivacyPurpose,
  type PrivacyUrlMode,
  classifyProbeError,
  decideFromProbe,
  isCaptureBlocked,
  isUrlPattern,
  normalize,
  patternHost,
  purposeEnabled,
} from './privacy-match.js';

export type {
  BrowserProbeResult,
  CapturePrivacyBlock,
  PrivacyDecision,
  PrivacyPurpose,
  PrivacyUrlMode,
} from './privacy-match.js';

export {
  isCaptureBlocked,
  isUrlPattern,
  normalize,
  patternHost,
  purposeEnabled,
  decideFromProbe,
  classifyProbeError,
  matchUrlBlock,
  matchAppBlock,
  urlMatchesHost,
  urlMatchesAnyHost,
} from './privacy-match.js';

const execFileAsync = promisify(execFile);

/** Chromium-family + Safari apps we can ask for tab URLs on macOS. */
const MAC_BROWSER_APPS = [
  'Google Chrome',
  'Brave Browser',
  'Microsoft Edge',
  'Chromium',
  'Arc',
  'Vivaldi',
  'Opera',
  'Dia',
  'Safari',
];

let blocks: CapturePrivacyBlock[] = [];
let urlMode: PrivacyUrlMode = 'blocklist';

let browserProbeCache: { at: number; result: BrowserProbeResult } | null = null;
let browserProbeInFlight: Promise<BrowserProbeResult> | null = null;
/** Short TTL so live view picks up navigations quickly; screenshots force refresh. */
const BROWSER_PROBE_CACHE_MS = 300;
const BROWSER_PROBE_TIMEOUT_MS = 1500;

let lastAllowLogAt = 0;
let lastUnknownLogAt = 0;

export function setCapturePrivacyBlocks(next: CapturePrivacyBlock[]): void {
  blocks = Array.isArray(next)
    ? next
        .filter(b => b && typeof b.appPattern === 'string' && b.appPattern.trim())
        .map(b => ({
          ...b,
          appPattern: b.appPattern.trim(),
        }))
    : [];
  // Invalidate probe cache when rules change.
  browserProbeCache = null;
  if (blocks.length) {
    console.log(`[privacy] loaded ${blocks.length} block(s): ${blocks.map(b => b.appPattern).join(', ')}`);
  } else {
    console.log('[privacy] loaded 0 blocks');
  }
}

export function setPrivacyUrlMode(mode: PrivacyUrlMode | string | null | undefined): void {
  urlMode = mode === 'allowlist' ? 'allowlist' : 'blocklist';
  console.log(`[privacy] url mode: ${urlMode}`);
}

export function getPrivacyUrlMode(): PrivacyUrlMode {
  return urlMode;
}

export function getCapturePrivacyBlocks(): CapturePrivacyBlock[] {
  return blocks;
}

async function listRunningMacBrowserApps(): Promise<{ ok: true; apps: string[] } | { ok: false; reason: string }> {
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      ['-e', 'tell application "System Events" to get name of every process whose background only is false'],
      { timeout: 800, maxBuffer: 128 * 1024 }
    );
    const names = new Set(
      String(stdout || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    );
    return { ok: true, apps: MAC_BROWSER_APPS.filter(app => names.has(app)) };
  } catch (err) {
    return { ok: false, reason: classifyProbeError(err) };
  }
}

type TabProbe = { ok: true; urls: string[] } | { ok: false; reason: string };

/**
 * Active-tab URLs only (one per browser window).
 * Background tabs must NOT block capture — only what can appear on screen.
 * Safari uses "current tab"; Chromium-family uses "active tab".
 */
async function probeActiveTabUrls(app: string): Promise<TabProbe> {
  const tabRef = app === 'Safari' ? 'current tab' : 'active tab';
  const script = `
    tell application "${app}"
      if not running then return ""
      set out to ""
      repeat with w in windows
        try
          set out to out & (URL of ${tabRef} of w) & linefeed
        end try
      end repeat
      return out
    end tell
  `;
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: BROWSER_PROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const urls = String(stdout || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(u => u.startsWith('http://') || u.startsWith('https://'));
    return { ok: true, urls };
  } catch (err) {
    return { ok: false, reason: classifyProbeError(err) };
  }
}

/**
 * Probe browser tab URLs. Distinguishes success (possibly empty) from failure.
 * Never treats a probe error as “no tabs.”
 */
export async function probeBrowserUrls(force = false): Promise<BrowserProbeResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, reason: 'url_probe_unsupported_platform' };
  }

  const now = Date.now();
  if (!force && browserProbeCache && now - browserProbeCache.at < BROWSER_PROBE_CACHE_MS) {
    return browserProbeCache.result;
  }
  if (browserProbeInFlight) return browserProbeInFlight;

  browserProbeInFlight = (async (): Promise<BrowserProbeResult> => {
    const running = await listRunningMacBrowserApps();
    if (!running.ok) {
      const result: BrowserProbeResult = { ok: false, reason: running.reason };
      browserProbeCache = { at: Date.now(), result };
      return result;
    }

    if (running.apps.length === 0) {
      const result: BrowserProbeResult = { ok: true, urls: [], browsers: [] };
      console.log('[privacy] active tabs: 0 url(s) from no browsers');
      browserProbeCache = { at: Date.now(), result };
      return result;
    }

    const settled = await Promise.all(
      running.apps.map(async app => ({ app, probe: await probeActiveTabUrls(app) }))
    );
    const failures = settled.filter(s => !s.probe.ok);
    if (failures.length) {
      // Any browser we could not query → fail-closed (might hide a protected active tab).
      const reason = failures[0].probe.ok === false ? failures[0].probe.reason : 'browser_probe_error';
      const result: BrowserProbeResult = { ok: false, reason };
      browserProbeCache = { at: Date.now(), result };
      return result;
    }

    const urls = [...new Set(settled.flatMap(s => (s.probe.ok ? s.probe.urls : [])))];
    const browsers = running.apps;
    console.log(
      `[privacy] active tabs: ${urls.length} url(s) from ${browsers.join(', ') || 'no browsers'}`
    );
    const result: BrowserProbeResult = { ok: true, urls, browsers };
    browserProbeCache = { at: Date.now(), result };
    return result;
  })().finally(() => {
    browserProbeInFlight = null;
  });

  return browserProbeInFlight;
}

/** @deprecated Prefer probeBrowserUrls; kept for callers that only need the URL list on success. */
export async function refreshBrowserUrls(force = false): Promise<string[]> {
  const result = await probeBrowserUrls(force);
  return result.ok ? result.urls : [];
}

export function prefetchBrowserUrlsForPrivacy(): void {
  void probeBrowserUrls(true);
}

async function collectWindowLabels(input?: {
  appName?: string | null;
  windowTitle?: string | null;
}): Promise<string[]> {
  const labels: string[] = [];
  if (input?.appName) labels.push(String(input.appName));
  if (input?.windowTitle) labels.push(String(input.windowTitle));
  try {
    const win = await getActiveWindow();
    if (win?.owner?.name) labels.push(win.owner.name);
    if (win?.title) labels.push(win.title);
  } catch { /* ignore */ }
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1, height: 1 },
    });
    for (const s of sources) {
      if (s?.name) labels.push(s.name);
    }
  } catch { /* ignore */ }
  return [...new Set(labels.map(l => l.trim()).filter(Boolean))];
}

function logDecision(decision: PrivacyDecision): void {
  if (decision.state === 'block') {
    const shown = decision.matchedUrl || decision.pattern;
    console.log(`[privacy] blocked "${shown}" via "${decision.matchedVia}"`);
    return;
  }
  if (decision.state === 'unknown') {
    const now = Date.now();
    if (now - lastUnknownLogAt > 2000) {
      lastUnknownLogAt = now;
      console.log(`[privacy] browser state unavailable: ${decision.reason}`);
      if (decision.reason === 'automation_permission') {
        console.log('[privacy] browser automation permission unavailable');
      }
    }
    return;
  }
  const now = Date.now();
  if (now - lastAllowLogAt > 8000) {
    lastAllowLogAt = now;
    console.log('[privacy] capture allowed');
  }
}

/**
 * Central privacy decision for all capture paths.
 * Capture adapters must treat block and unknown as “do not capture.”
 */
export async function decide(
  purpose: PrivacyPurpose,
  input?: {
    appName?: string | null;
    windowTitle?: string | null;
    forceRefresh?: boolean;
  }
): Promise<PrivacyDecision> {
  const relevant = blocks.filter(b => purposeEnabled(b, purpose));
  const urlBlocks = relevant.filter(b => isUrlPattern(b.appPattern));
  const needsUrlProbe = urlMode === 'allowlist' || urlBlocks.length > 0;

  if (!relevant.length && urlMode !== 'allowlist') {
    logDecision({ state: 'allow' });
    return { state: 'allow' };
  }

  let probe: BrowserProbeResult | null = null;
  if (needsUrlProbe) {
    probe = await probeBrowserUrls(input?.forceRefresh === true);
  }

  let labels: string[] = [];
  const appBlocks = relevant.filter(b => !isUrlPattern(b.appPattern));
  if (appBlocks.length) {
    labels = await collectWindowLabels(input);
  }

  const decision = decideFromProbe(purpose, blocks, probe, labels, urlMode);
  logDecision(decision);
  return decision;
}

/** Convenience: true when screenshot must not be taken. */
export async function shouldBlockScreenshotAsync(input?: {
  appName?: string | null;
  windowTitle?: string | null;
  forceRefresh?: boolean;
}): Promise<Extract<PrivacyDecision, { state: 'block' | 'unknown' }> | null> {
  const decision = await decide('screenshot', { ...input, forceRefresh: input?.forceRefresh !== false });
  if (isCaptureBlocked(decision)) {
    return decision as Extract<PrivacyDecision, { state: 'block' | 'unknown' }>;
  }
  return null;
}

/** Convenience: true when live view must not send real frames. */
export async function shouldBlockLiveViewAsync(input?: {
  appName?: string | null;
  windowTitle?: string | null;
  forceRefresh?: boolean;
}): Promise<Extract<PrivacyDecision, { state: 'block' | 'unknown' }> | null> {
  const decision = await decide('liveView', input);
  if (isCaptureBlocked(decision)) {
    return decision as Extract<PrivacyDecision, { state: 'block' | 'unknown' }>;
  }
  return null;
}

/** @deprecated Prefer decide() / shouldBlockScreenshotAsync */
export function shouldBlockScreenshot(_appName?: string | null, _windowTitle?: string | null): null {
  return null;
}

/** @deprecated Prefer decide() / shouldBlockLiveViewAsync */
export function shouldBlockLiveView(_appName?: string | null, _windowTitle?: string | null): null {
  return null;
}

/** @deprecated Prefer decide() */
export async function evaluateCapturePrivacy(input?: {
  appName?: string | null;
  windowTitle?: string | null;
}): Promise<{
  pattern: string;
  blockScreenshots: boolean;
  blockLiveView: boolean;
  matchedVia: string;
  matchedIn?: string;
} | null> {
  const decision = await decide('screenshot', { ...input, forceRefresh: false });
  if (decision.state === 'block') {
    return {
      pattern: decision.pattern,
      blockScreenshots: decision.blockScreenshots,
      blockLiveView: decision.blockLiveView,
      matchedVia: decision.matchedVia,
      matchedIn: decision.matchedUrl,
    };
  }
  if (decision.state === 'unknown') {
    // Represent unknown as a synthetic block so legacy callers skip capture.
    return {
      pattern: '(browser state unavailable)',
      blockScreenshots: true,
      blockLiveView: true,
      matchedVia: decision.reason,
      matchedIn: decision.reason,
    };
  }
  return null;
}
