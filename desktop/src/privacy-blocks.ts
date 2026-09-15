// Org privacy rules: skip screenshots / live frames when a blocked app/site
// is open on the desktop (not only the focused window).
//
// Full-screen capture shows every visible window, so we match against:
//   - tracker context (app + title)
//   - active-win (when available)
//   - ALL Electron desktopCapturer window source names (most reliable for browsers)
//
// Patterns may be plain names ("WhatsApp") or URLs ("https://web.whatsapp.com/") —
// URLs expand to host + brand tokens (whatsapp).

import { desktopCapturer } from 'electron';
import { getActiveWindow } from './active-window.js';

export interface CapturePrivacyBlock {
  id?: string;
  appPattern: string;
  employeeId?: string | null;
  blockScreenshots: boolean;
  blockLiveView: boolean;
}

export interface PrivacyMatch {
  pattern: string;
  blockScreenshots: boolean;
  blockLiveView: boolean;
  matchedVia: string;
  matchedIn?: string;
}

let blocks: CapturePrivacyBlock[] = [];

const SKIP_LABELS = new Set([
  'www', 'web', 'com', 'net', 'org', 'co', 'io', 'app', 'http', 'https',
  'html', 'php', 'asp', 'www2', 'm', 'mobile',
]);

export function setCapturePrivacyBlocks(next: CapturePrivacyBlock[]): void {
  blocks = Array.isArray(next)
    ? next.filter(b => b && typeof b.appPattern === 'string' && b.appPattern.trim())
    : [];
  if (blocks.length) {
    console.log(`[privacy] loaded ${blocks.length} block(s): ${blocks.map(b => b.appPattern).join(', ')}`);
  } else {
    console.log('[privacy] loaded 0 blocks');
  }
}

export function getCapturePrivacyBlocks(): CapturePrivacyBlock[] {
  return blocks;
}

function normalize(s: string | undefined | null): string {
  return (s || '').toLowerCase().trim();
}

/** Expand a user pattern into match tokens (full string, host, brand names). */
export function expandPattern(raw: string): string[] {
  const p = normalize(raw);
  if (!p) return [];
  const out = new Set<string>([p]);

  const noProto = p.replace(/^https?:\/\//, '');
  const hostOrPath = noProto.split('/')[0] || '';
  if (hostOrPath) {
    out.add(hostOrPath);
    for (const label of hostOrPath.split('.')) {
      if (label.length >= 3 && !SKIP_LABELS.has(label)) out.add(label);
    }
  }

  for (const seg of noProto.split('/').slice(1)) {
    const clean = seg.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    if (clean.length >= 3 && !SKIP_LABELS.has(clean)) out.add(clean);
  }

  try {
    const asUrl = /^https?:\/\//.test(p) ? p : (p.includes('.') ? `https://${p}` : '');
    if (asUrl) {
      const u = new URL(asUrl);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (host) {
        out.add(host);
        for (const label of host.split('.')) {
          if (label.length >= 3 && !SKIP_LABELS.has(label)) out.add(label);
        }
      }
    }
  } catch { /* ignore */ }

  return [...out].sort((a, b) => b.length - a.length);
}

function haystackIncludes(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  if (haystack.includes(needle)) return true;
  const words = haystack.split(/[^a-z0-9]+/).filter(Boolean);
  return words.some(w => w === needle || (needle.length >= 4 && w.includes(needle)));
}

export function matchPrivacyBlockAgainstText(haystackRaw: string): PrivacyMatch | null {
  if (!blocks.length) return null;
  const haystack = normalize(haystackRaw);
  if (!haystack) return null;

  for (const block of blocks) {
    const tokens = expandPattern(block.appPattern);
    for (const token of tokens) {
      if (haystackIncludes(haystack, token)) {
        return {
          pattern: block.appPattern,
          blockScreenshots: block.blockScreenshots !== false,
          blockLiveView: block.blockLiveView !== false,
          matchedVia: token,
          matchedIn: haystack.slice(0, 120),
        };
      }
    }
  }
  return null;
}

/** Legacy helper — prefer evaluateCapturePrivacy(). */
export function matchPrivacyBlock(
  appName?: string | null,
  windowTitle?: string | null
): PrivacyMatch | null {
  return matchPrivacyBlockAgainstText(`${appName || ''} ${windowTitle || ''}`);
}

/**
 * Build a haystack from tracker context + active window + ALL open window titles.
 * Full-screen capture shows background windows too, so any matching open window blocks.
 */
export async function collectPrivacyHaystack(input?: {
  appName?: string | null;
  windowTitle?: string | null;
}): Promise<{ haystack: string; labels: string[] }> {
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
      // Tiny thumbnails — we only need window titles.
      thumbnailSize: { width: 1, height: 1 },
    });
    for (const s of sources) {
      if (s?.name) labels.push(s.name);
    }
  } catch { /* ignore */ }

  const unique = [...new Set(labels.map(l => l.trim()).filter(Boolean))];
  return { haystack: unique.join(' | '), labels: unique };
}

export async function evaluateCapturePrivacy(input?: {
  appName?: string | null;
  windowTitle?: string | null;
}): Promise<PrivacyMatch | null> {
  if (!blocks.length) return null;
  const { haystack } = await collectPrivacyHaystack(input);
  return matchPrivacyBlockAgainstText(haystack);
}

export async function shouldBlockScreenshotAsync(input?: {
  appName?: string | null;
  windowTitle?: string | null;
}): Promise<PrivacyMatch | null> {
  const match = await evaluateCapturePrivacy(input);
  if (!match?.blockScreenshots) return null;
  return match;
}

export async function shouldBlockLiveViewAsync(input?: {
  appName?: string | null;
  windowTitle?: string | null;
}): Promise<PrivacyMatch | null> {
  const match = await evaluateCapturePrivacy(input);
  if (!match?.blockLiveView) return null;
  return match;
}

export function shouldBlockScreenshot(appName?: string | null, windowTitle?: string | null): PrivacyMatch | null {
  const match = matchPrivacyBlock(appName, windowTitle);
  if (!match?.blockScreenshots) return null;
  return match;
}

export function shouldBlockLiveView(appName?: string | null, windowTitle?: string | null): PrivacyMatch | null {
  const match = matchPrivacyBlock(appName, windowTitle);
  if (!match?.blockLiveView) return null;
  return match;
}
