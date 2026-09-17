/**
 * Pure privacy matching helpers (no Electron / AppleScript).
 * Used by PrivacyGuard and unit tests.
 */

export interface CapturePrivacyBlock {
  id?: string;
  appPattern: string;
  employeeId?: string | null;
  blockScreenshots: boolean;
  blockLiveView: boolean;
}

export type PrivacyPurpose = 'screenshot' | 'liveView';

/** Org-level URL policy: block listed hosts, or allow only listed hosts. */
export type PrivacyUrlMode = 'blocklist' | 'allowlist';

export type PrivacyDecision =
  | { state: 'allow' }
  | {
      state: 'block';
      pattern: string;
      matchedVia: string;
      matchedUrl?: string;
      blockScreenshots: boolean;
      blockLiveView: boolean;
    }
  | { state: 'unknown'; reason: string };

export type BrowserProbeResult =
  | { ok: true; urls: string[]; browsers: string[] }
  | { ok: false; reason: string };

export function normalize(s: string | undefined | null): string {
  return (s || '')
    .normalize('NFKC')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .toLowerCase()
    .trim();
}

/** True when the admin pattern looks like a site URL / host. */
export function isUrlPattern(raw: string): boolean {
  const p = normalize(raw);
  if (!p) return false;
  if (/^https?:\/\//.test(p)) return true;
  // bare host: web.whatsapp.com, mail.google.com
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(p) && p.includes('.')) return true;
  return false;
}

/** Host to match (www. stripped). */
export function patternHost(raw: string): string | null {
  const p = normalize(raw);
  if (!p) return null;
  try {
    const asUrl = /^https?:\/\//.test(p) ? p : `https://${p}`;
    return new URL(asUrl).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function urlMatchesHost(tabUrl: string, host: string): boolean {
  try {
    const u = new URL(tabUrl);
    const tabHost = u.hostname.replace(/^www\./, '').toLowerCase();
    return tabHost === host || tabHost.endsWith(`.${host}`);
  } catch {
    return normalize(tabUrl).includes(host);
  }
}

export function purposeEnabled(block: CapturePrivacyBlock, purpose: PrivacyPurpose): boolean {
  if (purpose === 'screenshot') return block.blockScreenshots !== false;
  return block.blockLiveView !== false;
}

export function matchUrlBlock(
  block: CapturePrivacyBlock,
  tabUrls: string[]
): Extract<PrivacyDecision, { state: 'block' }> | null {
  const host = patternHost(block.appPattern);
  if (!host) return null;
  for (const url of tabUrls) {
    if (urlMatchesHost(url, host)) {
      return {
        state: 'block',
        pattern: block.appPattern,
        matchedVia: host,
        matchedUrl: url.slice(0, 120),
        blockScreenshots: block.blockScreenshots !== false,
        blockLiveView: block.blockLiveView !== false,
      };
    }
  }
  return null;
}

export function matchAppBlock(
  block: CapturePrivacyBlock,
  labels: string[]
): Extract<PrivacyDecision, { state: 'block' }> | null {
  const needle = normalize(block.appPattern);
  if (!needle || isUrlPattern(block.appPattern)) return null;
  const haystack = normalize(labels.join(' | '));
  if (!haystack) return null;
  if (haystack.includes(needle)) {
    return {
      state: 'block',
      pattern: block.appPattern,
      matchedVia: needle,
      matchedUrl: haystack.slice(0, 120),
      blockScreenshots: block.blockScreenshots !== false,
      blockLiveView: block.blockLiveView !== false,
    };
  }
  return null;
}

export function urlMatchesAnyHost(tabUrl: string, hosts: string[]): boolean {
  return hosts.some(host => urlMatchesHost(tabUrl, host));
}

/**
 * Core decision given a probe result and optional window labels.
 * Fail-closed: when URL rules require a probe and probe is not ok → unknown.
 *
 * blocklist: block when an active tab matches a listed URL host.
 * allowlist: block any active http(s) tab that is NOT on the listed hosts
 *            (empty allowlist ⇒ all websites blocked for that purpose).
 */
export function decideFromProbe(
  purpose: PrivacyPurpose,
  blocks: CapturePrivacyBlock[],
  probe: BrowserProbeResult | null,
  labels: string[] = [],
  urlMode: PrivacyUrlMode = 'blocklist'
): PrivacyDecision {
  const relevant = blocks.filter(b => purposeEnabled(b, purpose));
  const urlBlocks = relevant.filter(b => isUrlPattern(b.appPattern));
  const appBlocks = relevant.filter(b => !isUrlPattern(b.appPattern));
  const mode = urlMode === 'allowlist' ? 'allowlist' : 'blocklist';

  // Allowlist mode always evaluates browser URLs for this purpose (even with an empty list).
  const needsUrlProbe = mode === 'allowlist' || urlBlocks.length > 0;

  if (needsUrlProbe) {
    if (!probe) {
      return { state: 'unknown', reason: 'browser_state_unavailable' };
    }
    if (!probe.ok) {
      return { state: 'unknown', reason: probe.reason };
    }

    if (mode === 'allowlist') {
      const allowedHosts = urlBlocks
        .map(b => patternHost(b.appPattern))
        .filter((h): h is string => !!h);
      for (const url of probe.urls) {
        if (!urlMatchesAnyHost(url, allowedHosts)) {
          let host = 'unknown';
          try {
            host = new URL(url).hostname.replace(/^www\./, '');
          } catch { /* ignore */ }
          return {
            state: 'block',
            pattern: '(not on allowlist)',
            matchedVia: host,
            matchedUrl: url.slice(0, 120),
            blockScreenshots: purpose === 'screenshot',
            blockLiveView: purpose === 'liveView',
          };
        }
      }
    } else {
      for (const block of urlBlocks) {
        const hit = matchUrlBlock(block, probe.urls);
        if (hit) return hit;
      }
    }
  } else if (!relevant.length) {
    return { state: 'allow' };
  }

  for (const block of appBlocks) {
    const hit = matchAppBlock(block, labels);
    if (hit) return hit;
  }

  return { state: 'allow' };
}

/** Adapters must not capture when decision is block or unknown. */
export function isCaptureBlocked(decision: PrivacyDecision): boolean {
  return decision.state === 'block' || decision.state === 'unknown';
}

/** Classify osascript / exec errors into stable reason codes. */
export function classifyProbeError(err: unknown): string {
  const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
  const code = (err as { code?: string | number })?.code;
  if (
    msg.includes('not authorized') ||
    msg.includes('not allowed') ||
    msg.includes('(-1743)') ||
    msg.includes('-1743') ||
    msg.includes('accessibility') ||
    msg.includes('automation')
  ) {
    return 'automation_permission';
  }
  if (code === 'ETIMEDOUT' || msg.includes('timed out') || msg.includes('timeout')) {
    return 'automation_timeout';
  }
  return 'browser_probe_error';
}
