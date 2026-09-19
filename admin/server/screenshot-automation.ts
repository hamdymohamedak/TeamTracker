/**
 * Server-side screenshot automation sessions.
 *
 * Repeats on-demand screenshot commands on a fixed or random interval.
 * Sessions are in-memory (like live-view) and stop when the employee device
 * disconnects, when the admin stops them, or when the configured duration ends.
 */

import { randomUUID } from 'crypto';
import { broadcastToAdmins, isEmployeeOnline } from './websocket/clients.js';
import { requestScreenshotCommand } from './websocket/remote-commands.js';

export type ScreenshotAutomationMode = 'fixed' | 'random';

export interface ScreenshotAutomationSession {
  sessionId: string;
  orgId: string;
  employeeId: string;
  startedBy: string;
  mode: ScreenshotAutomationMode;
  /** Fixed interval in seconds (mode === 'fixed'). */
  intervalSec: number;
  /** Random range in seconds (mode === 'random'). */
  minIntervalSec: number;
  maxIntervalSec: number;
  /** Wall-clock end; null = run until stopped / disconnect. */
  endsAt: string | null;
  /** Total run budget in hours (0 = unlimited). */
  durationHours: number;
  startedAt: string;
  timer: NodeJS.Timeout | null;
  endTimer: NodeJS.Timeout | null;
}

export const AUTOMATION_MIN_SEC = 30;
export const AUTOMATION_MAX_SEC = 15 * 60; // 15 minutes
/** Allowed duration budgets (hours). 0 = until manually stopped. */
export const AUTOMATION_DURATION_HOURS = [0, 1, 2, 4, 8, 12] as const;
export const AUTOMATION_MAX_DURATION_HOURS = 12;

const sessions = new Map<string, ScreenshotAutomationSession>();

function clampSec(n: number): number {
  return Math.max(AUTOMATION_MIN_SEC, Math.min(AUTOMATION_MAX_SEC, Math.round(n)));
}

function clampDurationHours(n: unknown): number {
  const h = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  if (h <= 0) return 0;
  return Math.min(AUTOMATION_MAX_DURATION_HOURS, h);
}

function nextDelayMs(session: ScreenshotAutomationSession): number {
  if (session.mode === 'random') {
    const min = session.minIntervalSec;
    const max = Math.max(session.minIntervalSec, session.maxIntervalSec);
    const sec = min + Math.random() * (max - min);
    return Math.round(sec * 1000);
  }
  return session.intervalSec * 1000;
}

function publicView(session: ScreenshotAutomationSession) {
  return {
    sessionId: session.sessionId,
    orgId: session.orgId,
    employeeId: session.employeeId,
    mode: session.mode,
    intervalSec: session.mode === 'fixed' ? session.intervalSec : undefined,
    minIntervalSec: session.mode === 'random' ? session.minIntervalSec : undefined,
    maxIntervalSec: session.mode === 'random' ? session.maxIntervalSec : undefined,
    durationHours: session.durationHours,
    endsAt: session.endsAt,
    startedAt: session.startedAt,
    startedBy: session.startedBy,
  };
}

function clearTimers(session: ScreenshotAutomationSession): void {
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
  if (session.endTimer) {
    clearTimeout(session.endTimer);
    session.endTimer = null;
  }
}

function broadcastEnded(
  orgId: string,
  employeeId: string,
  sessionId: string,
  reason: string
): void {
  broadcastToAdmins(orgId, {
    type: 'screenshot-automation:ended',
    data: {
      sessionId,
      employeeId,
      reason,
      timestamp: new Date().toISOString(),
    },
  });
}

function isExpired(session: ScreenshotAutomationSession): boolean {
  if (!session.endsAt) return false;
  return Date.now() >= Date.parse(session.endsAt);
}

function scheduleNext(session: ScreenshotAutomationSession): void {
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
  if (!sessions.has(session.employeeId)) return;
  if (isExpired(session)) {
    endAutomationForEmployee(session.employeeId, 'duration-elapsed');
    return;
  }
  let delay = nextDelayMs(session);
  if (session.endsAt) {
    const remaining = Date.parse(session.endsAt) - Date.now();
    if (remaining <= 0) {
      endAutomationForEmployee(session.employeeId, 'duration-elapsed');
      return;
    }
    delay = Math.min(delay, remaining);
  }
  session.timer = setTimeout(() => {
    void tick(session.employeeId);
  }, delay);
}

function scheduleHardEnd(session: ScreenshotAutomationSession): void {
  if (session.endTimer) {
    clearTimeout(session.endTimer);
    session.endTimer = null;
  }
  if (!session.endsAt) return;
  const ms = Date.parse(session.endsAt) - Date.now();
  if (ms <= 0) {
    endAutomationForEmployee(session.employeeId, 'duration-elapsed');
    return;
  }
  session.endTimer = setTimeout(() => {
    endAutomationForEmployee(session.employeeId, 'duration-elapsed');
  }, ms);
}

function tick(employeeId: string): void {
  const session = sessions.get(employeeId);
  if (!session) return;

  if (isExpired(session)) {
    endAutomationForEmployee(employeeId, 'duration-elapsed');
    return;
  }

  if (!isEmployeeOnline(session.orgId, session.employeeId)) {
    endAutomationForEmployee(employeeId, 'device-offline');
    return;
  }

  try {
    requestScreenshotCommand({
      orgId: session.orgId,
      employeeId: session.employeeId,
      requestedBy: session.startedBy,
    });
  } catch (err) {
    console.warn(
      '[screenshot-automation] tick failed:',
      (err as Error).message
    );
  }

  if (!sessions.has(employeeId)) return;
  scheduleNext(session);
}

export function listAutomationsForOrg(orgId: string) {
  const out = [];
  for (const session of sessions.values()) {
    if (session.orgId === orgId) out.push(publicView(session));
  }
  return out;
}

export function getAutomationForEmployee(employeeId: string) {
  const session = sessions.get(employeeId);
  return session ? publicView(session) : null;
}

export function startAutomation(input: {
  orgId: string;
  employeeId: string;
  startedBy: string;
  mode: ScreenshotAutomationMode;
  intervalSec?: number;
  minIntervalSec?: number;
  maxIntervalSec?: number;
  durationHours?: number;
}): { ok: true; session: ReturnType<typeof publicView> } | { ok: false; error: string; status: number } {
  if (!isEmployeeOnline(input.orgId, input.employeeId)) {
    return {
      ok: false,
      error: 'Employee tracker is offline. Ask them to open the desktop app, then try again.',
      status: 409,
    };
  }

  const mode: ScreenshotAutomationMode = input.mode === 'random' ? 'random' : 'fixed';
  let intervalSec = AUTOMATION_MIN_SEC;
  let minIntervalSec = AUTOMATION_MIN_SEC;
  let maxIntervalSec = 120;
  const durationHours = clampDurationHours(input.durationHours);

  if (mode === 'fixed') {
    if (typeof input.intervalSec !== 'number' || !Number.isFinite(input.intervalSec)) {
      return { ok: false, error: 'intervalSec is required for fixed mode', status: 400 };
    }
    intervalSec = clampSec(input.intervalSec);
  } else {
    if (
      typeof input.minIntervalSec !== 'number' ||
      typeof input.maxIntervalSec !== 'number' ||
      !Number.isFinite(input.minIntervalSec) ||
      !Number.isFinite(input.maxIntervalSec)
    ) {
      return { ok: false, error: 'minIntervalSec and maxIntervalSec are required for random mode', status: 400 };
    }
    minIntervalSec = clampSec(input.minIntervalSec);
    maxIntervalSec = clampSec(input.maxIntervalSec);
    if (maxIntervalSec < minIntervalSec) {
      const swap = minIntervalSec;
      minIntervalSec = maxIntervalSec;
      maxIntervalSec = swap;
    }
  }

  // Replace any existing session for this employee.
  endAutomationForEmployee(input.employeeId, 'replaced');

  const startedAtMs = Date.now();
  const endsAt =
    durationHours > 0
      ? new Date(startedAtMs + durationHours * 3600_000).toISOString()
      : null;

  const session: ScreenshotAutomationSession = {
    sessionId: randomUUID(),
    orgId: input.orgId,
    employeeId: input.employeeId,
    startedBy: input.startedBy,
    mode,
    intervalSec,
    minIntervalSec,
    maxIntervalSec,
    durationHours,
    endsAt,
    startedAt: new Date(startedAtMs).toISOString(),
    timer: null,
    endTimer: null,
  };
  sessions.set(input.employeeId, session);

  broadcastToAdmins(input.orgId, {
    type: 'screenshot-automation:started',
    data: {
      ...publicView(session),
      timestamp: new Date().toISOString(),
    },
  });

  // First capture immediately, then schedule the rest.
  try {
    requestScreenshotCommand({
      orgId: session.orgId,
      employeeId: session.employeeId,
      requestedBy: session.startedBy,
    });
  } catch (err) {
    console.warn(
      '[screenshot-automation] initial capture failed:',
      (err as Error).message
    );
  }

  scheduleHardEnd(session);
  scheduleNext(session);
  return { ok: true, session: publicView(session) };
}

export function stopAutomation(
  orgId: string,
  employeeId: string,
  reason = 'admin-stop'
): { ok: true; session: ReturnType<typeof publicView> } | { ok: false; error: string; status: number } {
  const session = sessions.get(employeeId);
  if (!session || session.orgId !== orgId) {
    return { ok: false, error: 'No active automation for this employee', status: 404 };
  }
  clearTimers(session);
  sessions.delete(employeeId);
  broadcastEnded(session.orgId, session.employeeId, session.sessionId, reason);
  return { ok: true, session: publicView(session) };
}

/** Called when a device tracker disconnects, duration ends, or is offline at tick. */
export function endAutomationForEmployee(
  employeeId: string,
  reason: string
): boolean {
  const session = sessions.get(employeeId);
  if (!session) return false;
  clearTimers(session);
  sessions.delete(employeeId);
  broadcastEnded(session.orgId, session.employeeId, session.sessionId, reason);
  return true;
}
