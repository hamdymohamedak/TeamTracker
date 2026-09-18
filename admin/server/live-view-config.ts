/**
 * Live View server configuration + ICE server builder.
 * TURN credentials are never logged.
 */

import { createHmac } from 'crypto';
import {
  DEFAULT_LIVE_VIEW_AUTO_CONFIG,
  DEFAULT_LIVE_VIEW_PROFILE_CONFIG,
  LIVE_VIEW_DEFAULT_MAX_FRAME_BYTES,
  LIVE_VIEW_DEFAULT_QUALITY_MODE,
  mergeAutoConfig,
  mergeProfileConfig,
  parseLiveViewQualityMode,
  type LiveViewAutoConfig,
  type LiveViewIceServer,
  type LiveViewProfileConfig,
  type LiveViewQualityMode,
} from '../shared/live-view/index.js';

export interface LiveViewEnvConfig {
  defaultQuality: LiveViewQualityMode;
  maxFrameBytes: number;
  maxFps: number;
  minFps: number;
  webrtcEnabled: boolean;
  wsFallbackEnabled: boolean;
  auto: LiveViewAutoConfig;
  profiles: LiveViewProfileConfig;
  stunServers: string[];
  turnUrls: string[];
  turnUsername: string | null;
  turnCredential: string | null;
  turnSecret: string | null;
  turnCredentialTtlSec: number;
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw || !raw.trim()) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v == null || v === '') return defaultValue;
  return v !== '0' && v.toLowerCase() !== 'false' && v !== 'off';
}

function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

let cached: LiveViewEnvConfig | null = null;

export function getLiveViewEnv(): LiveViewEnvConfig {
  if (cached) return cached;

  const maxFrameBytes = Math.max(
    32_000,
    envInt('LIVE_VIEW_MAX_FRAME_BYTES', LIVE_VIEW_DEFAULT_MAX_FRAME_BYTES)
  );

  const wsMaxFps = Math.max(0.5, envInt('LIVE_VIEW_MAX_FPS', DEFAULT_LIVE_VIEW_PROFILE_CONFIG.wsMaxFps));
  const wsMinFps = Math.max(0.5, envInt('LIVE_VIEW_MIN_FPS', DEFAULT_LIVE_VIEW_PROFILE_CONFIG.wsMinFps));

  cached = {
    defaultQuality: parseLiveViewQualityMode(
      process.env.LIVE_VIEW_DEFAULT_QUALITY,
      LIVE_VIEW_DEFAULT_QUALITY_MODE
    ),
    maxFrameBytes,
    maxFps: wsMaxFps,
    minFps: wsMinFps,
    webrtcEnabled: envBool('LIVE_VIEW_WEBRTC_ENABLED', true),
    wsFallbackEnabled: envBool('LIVE_VIEW_WS_FALLBACK_ENABLED', true),
    auto: mergeAutoConfig({
      upgradeDelayMs: envInt(
        'LIVE_VIEW_AUTO_UPGRADE_DELAY',
        DEFAULT_LIVE_VIEW_AUTO_CONFIG.upgradeDelayMs
      ),
      downgradeLatencyMs: envInt(
        'LIVE_VIEW_AUTO_DOWNGRADE_THRESHOLD',
        DEFAULT_LIVE_VIEW_AUTO_CONFIG.downgradeLatencyMs
      ),
      downgradeCooldownMs: envInt(
        'LIVE_VIEW_AUTO_DOWNGRADE_COOLDOWN',
        DEFAULT_LIVE_VIEW_AUTO_CONFIG.downgradeCooldownMs
      ),
    }),
    profiles: mergeProfileConfig({
      wsMaxFps,
      wsMinFps,
      lanMaxFps: Math.max(
        1,
        envInt('LAN_LIVE_VIEW_MAX_FPS', DEFAULT_LIVE_VIEW_PROFILE_CONFIG.lanMaxFps)
      ),
      lanDefaultFps: Math.max(
        1,
        envInt('LAN_LIVE_VIEW_DEFAULT_FPS', DEFAULT_LIVE_VIEW_PROFILE_CONFIG.lanDefaultFps)
      ),
      internetMaxFps: Math.max(
        0.5,
        envInt('INTERNET_LIVE_VIEW_MAX_FPS', DEFAULT_LIVE_VIEW_PROFILE_CONFIG.internetMaxFps)
      ),
      turnMaxFps: Math.max(
        0.5,
        envInt('TURN_LIVE_VIEW_MAX_FPS', DEFAULT_LIVE_VIEW_PROFILE_CONFIG.turnMaxFps)
      ),
      lanRttMaxMs: Math.max(
        5,
        envInt('LIVE_VIEW_LAN_RTT_MAX_MS', DEFAULT_LIVE_VIEW_PROFILE_CONFIG.lanRttMaxMs)
      ),
    }),
    stunServers: parseList(process.env.STUN_SERVERS, [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
    ]),
    turnUrls: parseList(process.env.TURN_URLS || process.env.TURN_URL, []),
    turnUsername: process.env.TURN_USERNAME?.trim() || null,
    turnCredential: process.env.TURN_CREDENTIAL?.trim() || null,
    turnSecret: process.env.TURN_SECRET?.trim() || null,
    turnCredentialTtlSec: Math.max(60, envInt('TURN_CREDENTIAL_TTL', 3600)),
  };

  return cached;
}

/** Reset cache (tests). */
export function resetLiveViewEnvCache(): void {
  cached = null;
}

/**
 * Coturn REST / static-auth-secret style temporary credentials:
 * username = `${expiryUnix}:${orgId}`
 * credential = base64(hmac-sha1(secret, username))
 */
export function mintTurnCredentials(
  secret: string,
  orgId: string,
  ttlSec: number
): { username: string; credential: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSec;
  const username = `${expiresAt}:${orgId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiresAt };
}

export function buildIceServers(orgId: string): LiveViewIceServer[] {
  const cfg = getLiveViewEnv();
  const servers: LiveViewIceServer[] = [];

  for (const url of cfg.stunServers) {
    servers.push({ urls: url });
  }

  if (cfg.turnUrls.length === 0) return servers;

  if (cfg.turnSecret) {
    const minted = mintTurnCredentials(cfg.turnSecret, orgId, cfg.turnCredentialTtlSec);
    for (const url of cfg.turnUrls) {
      servers.push({
        urls: url,
        username: minted.username,
        credential: minted.credential,
      });
    }
    return servers;
  }

  if (cfg.turnUsername && cfg.turnCredential) {
    for (const url of cfg.turnUrls) {
      servers.push({
        urls: url,
        username: cfg.turnUsername,
        credential: cfg.turnCredential,
      });
    }
  }

  return servers;
}

export function liveViewStartPayload(orgId: string, quality?: unknown) {
  const cfg = getLiveViewEnv();
  const q = parseLiveViewQualityMode(quality, cfg.defaultQuality);
  return {
    quality: q,
    webrtcEnabled: cfg.webrtcEnabled,
    wsFallbackEnabled: cfg.wsFallbackEnabled,
    maxFrameBytes: cfg.maxFrameBytes,
    maxFps: cfg.maxFps,
    minFps: cfg.minFps,
    iceServers: buildIceServers(orgId),
    autoConfig: {
      downgradeLatencyMs: cfg.auto.downgradeLatencyMs,
      upgradeLatencyMs: cfg.auto.upgradeLatencyMs,
      downgradeLossRatio: cfg.auto.downgradeLossRatio,
      upgradeLossRatio: cfg.auto.upgradeLossRatio,
      downgradeBacklog: cfg.auto.downgradeBacklog,
      downgradeCooldownMs: cfg.auto.downgradeCooldownMs,
      upgradeDelayMs: cfg.auto.upgradeDelayMs,
      bitrateFloorFactor: cfg.auto.bitrateFloorFactor,
    },
    profileConfig: {
      wsMaxFps: cfg.profiles.wsMaxFps,
      wsMinFps: cfg.profiles.wsMinFps,
      lanMaxFps: cfg.profiles.lanMaxFps,
      lanDefaultFps: cfg.profiles.lanDefaultFps,
      internetMaxFps: cfg.profiles.internetMaxFps,
      turnMaxFps: cfg.profiles.turnMaxFps,
      lanRttMaxMs: cfg.profiles.lanRttMaxMs,
    },
  };
}
