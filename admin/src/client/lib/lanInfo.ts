/**
 * Preferred activation server URL for LAN employees.
 * Prefer /api/lan/info primaryUrl over window.location.origin when the
 * dashboard was opened via localhost (which other devices cannot reach).
 */

export type LanInfoResponse = {
  officeName: string;
  port: number;
  lanUrls: string[];
  discovery: boolean;
  primaryUrl: string | null;
};

export async function fetchLanInfo(): Promise<LanInfoResponse | null> {
  try {
    const res = await fetch('/api/lan/info', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as LanInfoResponse;
  } catch {
    return null;
  }
}

/** URL employees should use to reach this server from other LAN machines. */
export async function getPreferredActivationServerUrl(): Promise<string> {
  const origin = window.location.origin.replace(/\/+$/, '');
  const info = await fetchLanInfo();
  const primary = info?.primaryUrl?.replace(/\/+$/, '') || null;

  const isLoopback =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);

  if (isLoopback && primary) return primary;
  if (primary && info?.lanUrls?.some((u) => u.replace(/\/+$/, '') === origin)) {
    return origin;
  }
  // Prefer primary LAN URL when available so activation files work off this machine
  if (primary) return primary;
  return origin;
}

export function buildActivationPayload(opts: {
  setupToken: string;
  serverUrl: string;
  employeeName: string;
}): { setupToken: string; serverUrl: string; employeeName: string; createdAt: string } {
  return {
    setupToken: opts.setupToken,
    serverUrl: opts.serverUrl.replace(/\/+$/, ''),
    employeeName: opts.employeeName,
    createdAt: new Date().toISOString(),
  };
}
