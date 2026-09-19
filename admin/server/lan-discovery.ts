/**
 * LAN office discovery via mDNS/Bonjour.
 * Advertises `_teamtracker._tcp` so employee apps can find this server without typing an IP.
 */
import os from 'os';
import type { Express } from 'express';
import { getDatabase } from './database.js';
import { logger } from './logger.js';

export const TEAMTRACKER_MDNS_TYPE = 'teamtracker';
export const TEAMTRACKER_MDNS_PROTOCOL = 'tcp';
export const DEFAULT_OFFICE_NAME = 'TeamTracker Office';
export const APP_VERSION = '1.0.0';

export type LanInfo = {
  officeName: string;
  port: number;
  lanUrls: string[];
  discovery: boolean;
  primaryUrl: string | null;
};

type BonjourLike = {
  publish: (opts: Record<string, unknown>) => { stop: (cb?: () => void) => void; name?: string };
  unpublishAll: (cb?: () => void) => void;
  destroy: () => void;
};

let bonjour: BonjourLike | null = null;
let publishedService: { stop: (cb?: () => void) => void } | null = null;
let lastOfficeName = DEFAULT_OFFICE_NAME;
let advertising = false;

/** True unless TEAMTRACKER_LAN_DISCOVERY is explicitly 0/false/off. */
export function isLanDiscoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.TEAMTRACKER_LAN_DISCOVERY || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  return true;
}

/** Collect non-internal IPv4 addresses suitable for LAN clients. */
export function listLanIPv4(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): string[] {
  const out: string[] = [];
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== 'IPv4' && (entry.family as unknown) !== 4) continue;
      if (entry.internal) continue;
      // Skip link-local 169.254.x.x
      if (entry.address.startsWith('169.254.')) continue;
      out.push(entry.address);
    }
  }
  return out;
}

export function buildLanUrls(port: number, ips: string[] = listLanIPv4()): string[] {
  return ips.map((ip) => `http://${ip}:${port}`);
}

export function sanitizeOfficeName(name: string): string {
  const cleaned = name.replace(/[^\w\s\-./&()äöüÄÖÜß\u0600-\u06FF]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 63) || DEFAULT_OFFICE_NAME;
}

export async function resolveOfficeName(): Promise<string> {
  const fromEnv = (process.env.TEAMTRACKER_OFFICE_NAME || '').trim();
  if (fromEnv) return sanitizeOfficeName(fromEnv);

  try {
    const db = getDatabase();
    const row = await db.get<{ name: string }>(
      'SELECT name FROM organizations ORDER BY created_at ASC LIMIT 1'
    );
    if (row?.name?.trim()) return sanitizeOfficeName(row.name);
  } catch {
    // DB may not be ready during early tests
  }
  return DEFAULT_OFFICE_NAME;
}

export function getLanInfoSync(port: number, officeName?: string): LanInfo {
  const discovery = isLanDiscoveryEnabled();
  const lanUrls = buildLanUrls(port);
  const name = officeName || lastOfficeName;
  return {
    officeName: name,
    port,
    lanUrls,
    discovery,
    primaryUrl: lanUrls[0] || null,
  };
}

export async function getLanInfo(port: number): Promise<LanInfo> {
  const officeName = await resolveOfficeName();
  lastOfficeName = officeName;
  return getLanInfoSync(port, officeName);
}

export function setupLanRoutes(app: Express, port: number): void {
  app.get('/api/lan/info', async (_req, res) => {
    try {
      const info = await getLanInfo(port);
      res.json(info);
    } catch (err) {
      res.status(500).json({
        officeName: DEFAULT_OFFICE_NAME,
        port,
        lanUrls: [],
        discovery: isLanDiscoveryEnabled(),
        primaryUrl: null,
        error: String(err),
      });
    }
  });
}

export async function startLanAdvertising(port: number): Promise<void> {
  if (!isLanDiscoveryEnabled()) {
    logger.info('LAN discovery disabled (TEAMTRACKER_LAN_DISCOVERY)');
    return;
  }
  if (advertising) return;

  const officeName = await resolveOfficeName();
  lastOfficeName = officeName;

  try {
    const { Bonjour } = await import('bonjour-service');
    bonjour = new Bonjour() as unknown as BonjourLike;
    publishedService = bonjour.publish({
      name: officeName,
      type: TEAMTRACKER_MDNS_TYPE,
      protocol: TEAMTRACKER_MDNS_PROTOCOL,
      port,
      txt: {
        path: '/',
        proto: 'http',
        ver: APP_VERSION,
      },
    });
    advertising = true;
    logger.info('LAN discovery advertising', {
      officeName,
      type: `_${TEAMTRACKER_MDNS_TYPE}._${TEAMTRACKER_MDNS_PROTOCOL}`,
      port,
      lanUrls: buildLanUrls(port),
    });
  } catch (err) {
    logger.warn('LAN discovery failed to start', { error: String(err) });
  }
}

export function stopLanAdvertising(): void {
  if (!bonjour && !publishedService) return;
  try {
    if (publishedService) {
      publishedService.stop();
      publishedService = null;
    }
    if (bonjour) {
      bonjour.unpublishAll();
      bonjour.destroy();
      bonjour = null;
    }
  } catch (err) {
    logger.warn('LAN discovery stop error', { error: String(err) });
  }
  advertising = false;
}

export function isLanAdvertising(): boolean {
  return advertising;
}
