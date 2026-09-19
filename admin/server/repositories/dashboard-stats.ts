import type { Activity } from '../../shared-types.js';
import { computeProductivityStats } from '../../shared-types.js';
import { getDatabase } from '../database/connection.js';
import { getLocalDayBounds, resolveTimezone } from '../timezone.js';
import { annotateOutsideHours, hasBusinessHours } from '../business-hours.js';

// ---------------------------------------------------------------------------
// Dashboard stats — unified productivity formula + timezone-aware "today".
// ---------------------------------------------------------------------------
// The caller may pass an explicit `viewTimezone` (usually the admin browser's
// IANA zone, detected with `Intl.DateTimeFormat().resolvedOptions().timeZone`).
// When absent we fall back to the organization's stored timezone, and if that
// is also unset we fall back to UTC.
//
// All "today" queries use `[startUtc, endUtc)` day boundaries computed in the
// resolved tz so that a PST admin refreshing at 11:55pm still sees *their*
// day, not UTC's.

export const SYSTEM_APP_BLACKLIST = [
  'loginwindow',
  'lockscreen',
  'screensaver',
  'window server',
  'idle',
  'usernotificationcenter',
  'controlcenter',
  'dock',
  'notificationcenter'
];

const BROWSER_APP_HINTS = [
  'chrome',
  'firefox',
  'safari',
  'edge',
  'brave',
  'opera',
  'vivaldi',
  'arc',
  'dia',
  'chromium',
];

function isBrowserAppName(appName: string): boolean {
  const n = appName.toLowerCase();
  return BROWSER_APP_HINTS.some(h => n.includes(h));
}

/**
 * Short sidebar/dashboard label for "what is this employee doing?"
 * Prefer the OS app name so a Chrome tab titled "WhatsApp" is never shown as
 * if WhatsApp were the focused desktop app. For browsers, append a truncated
 * tab title for context.
 */
export function formatCurrentActivity(
  appName?: string | null,
  windowTitle?: string | null
): string | undefined {
  const app = (appName || '').trim();
  const title = (windowTitle || '').trim();
  if (!app && !title) return undefined;
  if (!app) return title;
  if (!title || title.toLowerCase() === app.toLowerCase()) return app;
  if (isBrowserAppName(app)) {
    const short = title.length > 40 ? `${title.slice(0, 37)}…` : title;
    return `${app} · ${short}`;
  }
  return app;
}

function normalizeMatchText(s: string | undefined | null): string {
  return String(s || '')
    .normalize('NFKC')
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
    .trim()
    .toLowerCase();
}

type PrivacyPatternRow = {
  employee_id: string | null;
  app_pattern: string;
  aliases: string;
};

/** Heuristic: activity app/title contains a privacy pattern or alias (estimate only). */
export function activityMatchesPrivacyPatterns(
  appName: string | undefined | null,
  windowTitle: string | undefined | null,
  patterns: Array<{ needles: string[] }>
): boolean {
  if (!patterns.length) return false;
  const hay = normalizeMatchText(`${appName || ''} ${windowTitle || ''}`);
  if (!hay) return false;
  for (const p of patterns) {
    for (const needle of p.needles) {
      if (needle && hay.includes(needle)) return true;
    }
  }
  return false;
}

function buildPrivacyNeedles(row: PrivacyPatternRow): string[] {
  const needles: string[] = [];
  const raw = (row.app_pattern || '').trim();
  if (raw) {
    needles.push(normalizeMatchText(raw));
    // Host-like patterns: also match the first label (whatsapp from web.whatsapp.com).
    const hostish = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    if (hostish) {
      needles.push(normalizeMatchText(hostish));
      const label = hostish.split('.').filter(Boolean);
      if (label.length >= 2) {
        // web.whatsapp.com → whatsapp
        needles.push(normalizeMatchText(label[label.length - 2]));
      }
    }
  }
  try {
    const aliases = JSON.parse(row.aliases || '[]');
    if (Array.isArray(aliases)) {
      for (const a of aliases) {
        const n = normalizeMatchText(String(a));
        if (n) needles.push(n);
      }
    }
  } catch { /* ignore */ }
  return [...new Set(needles.filter(Boolean))];
}

function topAppFromRows(rows: Array<{ app_name?: string; duration_seconds?: number }>): {
  topAppName?: string;
  topAppSeconds: number;
} {
  const byApp = new Map<string, number>();
  for (const r of rows) {
    const name = (r.app_name || '').trim() || 'Unknown';
    if (name.toLowerCase() === 'idle') continue;
    const sec = Number(r.duration_seconds) || 0;
    byApp.set(name, (byApp.get(name) || 0) + sec);
  }
  let topAppName: string | undefined;
  let topAppSeconds = 0;
  for (const [name, sec] of byApp) {
    if (sec > topAppSeconds) {
      topAppSeconds = sec;
      topAppName = name;
    }
  }
  return { topAppName, topAppSeconds };
}

export async function getDashboardStats(
  orgId: string,
  viewTimezone?: string,
  scope: 'today' | 'week' | 'all' = 'today'
): Promise<any> {
  const db = getDatabase();

  // Resolve the timezone the admin wants to see "today" in.
  const orgRow = await db.get('SELECT timezone FROM organizations WHERE id = ?', [orgId]);
  const tz = resolveTimezone(viewTimezone || orgRow?.timezone);

  // Window bounds for the requested scope. The dashboard tiles ("focus
  // today", productivity, breakdown) all read from this same window so the
  // toggle is just one switch in one place.
  let startTodayUtc: string;
  let endTodayUtc: string;
  if (scope === 'week') {
    const { getLocalWindowBounds } = await import('../timezone.js');
    [startTodayUtc, endTodayUtc] = getLocalWindowBounds(tz, 7);
  } else if (scope === 'all') {
    // Cap at "year ago" so SQLite doesn't have to scan billions of rows on
    // a long-running install. Adjust upward when needed.
    const { getLocalWindowBounds } = await import('../timezone.js');
    [startTodayUtc, endTodayUtc] = getLocalWindowBounds(tz, 365);
  } else {
    [startTodayUtc, endTodayUtc] = getLocalDayBounds(tz, 0);
  }

  const withTimeout = <T>(promise: Promise<T>, ms: number, defaultValue: T): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)
      )
    ]).catch(err => {
      console.warn('Dashboard stats query failed:', err.message);
      return defaultValue;
    });
  };

  // Build the system-app exclusion fragment for the activity feed.
  const feedExclusion = SYSTEM_APP_BLACKLIST.map(() => 'LOWER(app_name) != ?').join(' AND ');
  const feedParams: any[] = [orgId, ...SYSTEM_APP_BLACKLIST];

  const [
    totalEmployees,
    activeProjects,
    todayActivities,
    recentActivities,
    suspiciousCount
  ] = await Promise.all([
    withTimeout(db.get('SELECT COUNT(*) as count FROM employees WHERE is_active = 1 AND org_id = ?', [orgId]), 5000, { count: 0 }),
    withTimeout(db.get('SELECT COUNT(*) as count FROM projects WHERE status = "active" AND org_id = ?', [orgId]), 5000, { count: 0 }),
    withTimeout(
      db.all(
        `SELECT * FROM activities
          WHERE org_id = ? AND timestamp >= ? AND timestamp < ?`,
        [orgId, startTodayUtc, endTodayUtc]
      ),
      5000,
      []
    ),
    withTimeout(
      db.all(
        `SELECT * FROM activities
          WHERE org_id = ? AND ${feedExclusion}
          ORDER BY timestamp DESC, created_at DESC
          LIMIT 20`,
        feedParams
      ),
      5000,
      []
    ),
    withTimeout(
      db.get(
        `SELECT COUNT(*) as count FROM activities
          WHERE timestamp >= ? AND timestamp < ?
            AND is_suspicious = 1 AND org_id = ?`,
        [startTodayUtc, endTodayUtc, orgId]
      ),
      5000,
      { count: 0 }
    )
  ]);

  // Compute unified stats across the whole org for the selected scope.
  // Apply each employee's business hours so org tiles match per-employee cards.
  const employeesForBh = await withTimeout(
    db.all(
      `SELECT id, timezone, business_hours_start, business_hours_end, business_hours_days
       FROM employees WHERE is_active = 1 AND org_id = ?`,
      [orgId]
    ),
    5000,
    []
  );
  const empById = new Map((employeesForBh as any[]).map((e: any) => [e.id, e]));
  const mappedToday = (todayActivities as any[]).map((row: any) => {
    const base = mapActivity(row);
    const emp = empById.get(row.employee_id);
    if (!hasBusinessHours(emp)) {
      return { ...base, outsideBusinessHours: false };
    }
    return annotateOutsideHours([base], emp, tz)[0];
  });
  const stats = computeProductivityStats(mappedToday);

  // Minutes per bucket for the dashboard's "Time Breakdown (Today)" grid.
  const minutes = (sec: number) => Math.round(sec / 60);
  const productivityBreakdown = {
    coreWork:         minutes(stats.categorySeconds.core_work || 0),
    communication:    minutes(stats.categorySeconds.communication || 0),
    researchLearning: minutes(stats.categorySeconds.research_learning || 0),
    planningDocs:     minutes(stats.categorySeconds.planning_docs || 0),
    breakIdle:        minutes(stats.categorySeconds.break_idle || 0),
    entertainment:    minutes(stats.categorySeconds.entertainment || 0),
    socialMedia:      minutes(stats.categorySeconds.social_media || 0),
    shoppingPersonal: minutes(stats.categorySeconds.shopping_personal || 0),
    other:            minutes(stats.categorySeconds.other || 0)
  };

  const employeeActivity = await withTimeout(
    getEmployeeActivityStats(orgId, tz),
    5000,
    []
  );

  return {
    timezone: tz,
    scope,
    dayStart: startTodayUtc,
    dayEnd: endTodayUtc,
    totalEmployees: totalEmployees.count,
    activeProjects: activeProjects.count,
    // All duration-carrying fields exposed as both seconds (source of truth)
    // and the legacy hours/minutes values (kept so older clients still work).
    totalSecondsToday:       stats.totalSeconds,
    focusSecondsToday:       stats.productiveSeconds,
    distractedSecondsToday:  stats.unproductiveSeconds + stats.idleSeconds,
    productiveSecondsToday:  stats.productiveSeconds,
    unproductiveSecondsToday: stats.unproductiveSeconds,
    neutralSecondsToday:     stats.neutralSeconds,
    idleSecondsToday:        stats.idleSeconds,
    totalHoursToday:         Math.round(stats.totalSeconds / 3600 * 10) / 10,
    focusTimeMinutes:        Math.round(stats.productiveSeconds / 60),
    distractedTimeMinutes:   Math.round((stats.unproductiveSeconds + stats.idleSeconds) / 60),
    productivityBreakdown,
    averageProductivityScore: stats.productivityScore,
    suspiciousActivityCount: suspiciousCount.count,
    recentActivities: (recentActivities as any[]).map(mapActivity),
    employeeActivity
  };
}

// Get employee activity with unified productivity metrics.
// Uses the same formula as Reports so the dashboard card and the report agree.
export async function getEmployeeActivityStats(orgId: string, tz?: string): Promise<any[]> {
  const db = getDatabase();

  const orgRow = await db.get('SELECT timezone FROM organizations WHERE id = ?', [orgId]);
  const resolvedTz = resolveTimezone(tz || orgRow?.timezone);

  const [employees, privacyRows] = await Promise.all([
    db.all(
      `SELECT id, name, timezone, business_hours_start, business_hours_end, business_hours_days
       FROM employees
       WHERE is_active = 1 AND org_id = ?`,
      [orgId]
    ),
    db.all(
      `SELECT employee_id, app_pattern, aliases
       FROM capture_privacy_blocks WHERE org_id = ?`,
      [orgId]
    ),
  ]);

  const orgPrivacy = (privacyRows as PrivacyPatternRow[])
    .filter(r => !r.employee_id)
    .map(r => ({ needles: buildPrivacyNeedles(r) }));
  const empPrivacy = new Map<string, Array<{ needles: string[] }>>();
  for (const r of privacyRows as PrivacyPatternRow[]) {
    if (!r.employee_id) continue;
    const list = empPrivacy.get(r.employee_id) || [];
    list.push({ needles: buildPrivacyNeedles(r) });
    empPrivacy.set(r.employee_id, list);
  }

  const results = [];
  for (const emp of employees) {
    // Use the employee's own timezone for their "today" if set, else org tz.
    const empTz = resolveTimezone(emp.timezone || resolvedTz);
    const [empStart, empEnd] = getLocalDayBounds(empTz, 0);

    const [latestActivity, todayRows, suspiciousCount] = await Promise.all([
      db.get(
        'SELECT * FROM activities WHERE employee_id = ? ORDER BY timestamp DESC, created_at DESC LIMIT 1',
        emp.id
      ),
      db.all(
        `SELECT * FROM activities
          WHERE employee_id = ? AND timestamp >= ? AND timestamp < ?`,
        [emp.id, empStart, empEnd]
      ),
      db.get(
        `SELECT COUNT(*) as count FROM activities
          WHERE employee_id = ? AND timestamp >= ? AND timestamp < ? AND is_suspicious = 1`,
        [emp.id, empStart, empEnd]
      )
    ]);

    const mapped = (todayRows as any[]).map(mapActivity);
    const annotated = hasBusinessHours(emp)
      ? annotateOutsideHours(mapped, emp, resolvedTz)
      : mapped.map(a => ({ ...a, outsideBusinessHours: false }));
    const stats = computeProductivityStats(annotated);
    const { topAppName, topAppSeconds } = topAppFromRows(todayRows as any[]);

    const privacyPatterns = [
      ...orgPrivacy,
      ...(empPrivacy.get(emp.id) || []),
    ];
    let privacyMatchedSeconds = 0;
    for (const row of todayRows as any[]) {
      if (
        activityMatchesPrivacyPatterns(row.app_name, row.window_title, privacyPatterns)
      ) {
        privacyMatchedSeconds += Number(row.duration_seconds) || 0;
      }
    }

    results.push({
      employeeId: emp.id,
      employeeName: emp.name,
      currentActivity: formatCurrentActivity(
        latestActivity?.app_name,
        latestActivity?.window_title
      ),
      currentCategory: latestActivity?.category_name,
      lastActivityAt: latestActivity?.timestamp || null,
      productivityScore: stats.productivityScore,
      hoursToday: Math.round(stats.totalSeconds / 3600 * 10) / 10,
      secondsToday: stats.totalSeconds,
      productiveSeconds: stats.productiveSeconds,
      unproductiveSeconds: stats.unproductiveSeconds,
      neutralSeconds: stats.neutralSeconds,
      idleSeconds: stats.idleSeconds,
      topAppName: topAppName || null,
      topAppSeconds,
      privacyMatchedSeconds,
      suspiciousActivityCount: suspiciousCount?.count || 0,
      isIdle: latestActivity?.is_idle === 1,
      hasBusinessHours: hasBusinessHours(emp),
      outsideHoursSeconds: stats.outsideHoursSeconds
    });
  }

  return results;
}

// Private mapper — kept file-local, not re-exported.
function mapActivity(row: any): Activity {
  return {
    id: row.id,
    employeeId: row.employee_id,
    timestamp: row.timestamp,
    appName: row.app_name,
    windowTitle: row.window_title,
    category: row.category,
    categoryName: row.category_name,
    productivityScore: row.productivity_score,
    productivityLevel: row.productivity_level,
    isSuspicious: row.is_suspicious === 1,
    suspiciousReason: row.suspicious_reason,
    isIdle: row.is_idle === 1,
    idleTimeSeconds: row.idle_time_seconds,
    durationSeconds: row.duration_seconds,
    projectId: row.project_id || undefined,
    taskId: row.task_id || undefined,
    createdAt: row.created_at
  };
}
