/** Normalize admin-supplied privacy aliases (array, JSON string, or newline/comma list). */
export function parsePrivacyAliases(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return uniqueTrimmed(raw.map(a => String(a ?? '')));
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return uniqueTrimmed(parsed.map((a: unknown) => String(a ?? '')));
        }
      } catch {
        /* fall through to line/comma split */
      }
    }
    return uniqueTrimmed(trimmed.split(/[\n,]+/));
  }
  return [];
}

function uniqueTrimmed(parts: string[]): string[] {
  return [...new Set(parts.map(s => s.trim()).filter(Boolean))];
}

export function aliasesToJson(aliases: string[]): string {
  return JSON.stringify(aliases);
}

/** Extract hostname from a pattern URL or bare host. */
export function extractPatternHost(pattern: string): string | null {
  const raw = (pattern || '').trim().toLowerCase();
  if (!raw) return null;
  try {
    const asUrl = /^https?:\/\//.test(raw) ? raw : (raw.includes('.') ? `https://${raw}` : '');
    if (!asUrl) return null;
    return new URL(asUrl).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when pattern should be stored/matched as a site hostname. */
export function isUrlPrivacyPattern(pattern: string): boolean {
  const raw = (pattern || '').trim().toLowerCase();
  if (!raw) return false;
  if (/^https?:\/\//.test(raw)) return true;
  return /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw) && raw.includes('.');
}

/**
 * Canonical value to persist for a privacy block.
 * URLs/hosts → hostname without www.; app names → trimmed original.
 */
export function normalizePrivacyPattern(pattern: string): {
  stored: string;
  host: string | null;
} {
  const trimmed = (pattern || '').trim();
  if (!trimmed) return { stored: '', host: null };
  if (!isUrlPrivacyPattern(trimmed)) return { stored: trimmed, host: null };
  const host = extractPatternHost(trimmed);
  return { stored: host || trimmed, host };
}
