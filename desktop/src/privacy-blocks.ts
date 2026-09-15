// Org privacy rules: skip screenshots / live frames when the foreground
// app name or window title matches a configured pattern.
//
// Patterns may be plain names ("WhatsApp") or URLs ("https://web.whatsapp.com/") —
// URLs are expanded to host + brand tokens so browser tab titles still match.

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

  // Strip protocol + path manually (works even if URL() rejects the string).
  const noProto = p.replace(/^https?:\/\//, '');
  const hostOrPath = noProto.split('/')[0] || '';
  if (hostOrPath) {
    out.add(hostOrPath);
    for (const label of hostOrPath.split('.')) {
      if (label.length >= 3 && !SKIP_LABELS.has(label)) out.add(label);
    }
  }

  // Path segments: /whatsapp/foo → whatsapp
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

  // Prefer longer tokens first for clearer matchedVia logging.
  return [...out].sort((a, b) => b.length - a.length);
}

function haystackIncludes(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  if (haystack.includes(needle)) return true;
  // Soft match: "whatsapp web" vs token "whatsapp"
  const words = haystack.split(/[^a-z0-9]+/).filter(Boolean);
  return words.some(w => w === needle || (needle.length >= 4 && w.includes(needle)));
}

export function matchPrivacyBlock(
  appName?: string | null,
  windowTitle?: string | null
): PrivacyMatch | null {
  if (!blocks.length) return null;
  const app = normalize(appName);
  const title = normalize(windowTitle);
  const haystack = `${app} ${title}`.trim();
  if (!haystack) return null;

  for (const block of blocks) {
    const tokens = expandPattern(block.appPattern);
    for (const token of tokens) {
      if (haystackIncludes(app, token) || haystackIncludes(title, token) || haystackIncludes(haystack, token)) {
        return {
          pattern: block.appPattern,
          blockScreenshots: block.blockScreenshots !== false,
          blockLiveView: block.blockLiveView !== false,
          matchedVia: token,
        };
      }
    }
  }
  return null;
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
