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

  // Compute unified stats across the whole org for today.
  const mappedToday = (todayActivities as any[]).map(mapActivity);
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
  const [startTodayUtc, endTodayUtc] = getLocalDayBounds(resolvedTz, 0);

  const employees = await db.all(
    `SELECT id, name, timezone, business_hours_start, business_hours_end, business_hours_days
     FROM employees
     WHERE is_active = 1 AND org_id = ?`,
    [orgId]
  );

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

    results.push({
      employeeId: emp.id,
      employeeName: emp.name,
      currentActivity: latestActivity?.window_title,
      currentCategory: latestActivity?.category_name,
      productivityScore: stats.productivityScore,
      hoursToday: Math.round(stats.totalSeconds / 3600 * 10) / 10,
      secondsToday: stats.totalSeconds,
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
