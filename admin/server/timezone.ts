// Timezone-aware day-boundary helpers for TeamTracker.
//
// SQLite stores all activity timestamps as UTC ISO strings (e.g.
// "2026-04-06T14:30:00.000Z"). Comparing activities against "today" in UTC
// gives the wrong answer for any user whose calendar day differs from UTC
// (which is most of the planet). These helpers convert a local-day expressed
// in an IANA timezone into the [startUtc, endUtc] range you can safely pass
// into `WHERE timestamp >= ? AND timestamp < ?`.
//
// Usage:
//   const [startUtc, endUtc] = getLocalDayBounds('America/Los_Angeles');
//   // startUtc = "2026-04-05T07:00:00.000Z" (midnight PDT)
//   // endUtc   = "2026-04-06T07:00:00.000Z"
//
// All helpers fall back to UTC if the timezone is unknown.

const FALLBACK_TZ = 'UTC';

function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? (tz as string) : FALLBACK_TZ;
}

/**
 * Format a Date as "YYYY-MM-DD" in the given timezone.
 */
export function toLocalDateString(date: Date, tz: string): string {
  const zone = resolveTimezone(tz);
  // en-CA produces ISO-like "YYYY-MM-DD".
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/**
 * Return the UTC instant corresponding to 00:00:00.000 on the given local
 * calendar day in the given timezone. Handles DST transitions correctly.
 */
export function localMidnightUtc(localYmd: string, tz: string): Date {
  const zone = resolveTimezone(tz);
  // Treat the YMD as a civil date in `zone`, then find the UTC instant
  // where that zone reads 00:00:00. Always apply the offset correction —
  // do NOT bail early when UTC midnight already falls on the same YMD
  // (that bug made Africa/Cairo and other UTC+ zones use UTC midnight).
  const desiredAsUtcMs = Date.parse(`${localYmd}T00:00:00.000Z`);
  let guess = new Date(desiredAsUtcMs);

  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(guess);
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value || '0');
    // Some engines emit hour "24" for midnight — normalize.
    let hour = get('hour');
    if (hour === 24) hour = 0;
    const localAsUtcMs = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      hour,
      get('minute'),
      get('second')
    );
    const offsetMs = localAsUtcMs - guess.getTime();
    guess = new Date(desiredAsUtcMs - offsetMs);
  }
  return guess;
}

/**
 * Get [startUtcIso, endUtcIso] for a single local day, expressed in the
 * given timezone. `dayOffset` lets you get yesterday (-1), tomorrow (+1),
 * etc.
 */
export function getLocalDayBounds(
  tz: string | null | undefined,
  dayOffset: number = 0
): [string, string] {
  const zone = resolveTimezone(tz);
  const now = new Date();
  const todayYmd = toLocalDateString(now, zone);
  const [y, m, d] = todayYmd.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const target = new Date(base + dayOffset * 86400000);
  const targetYmd = target.toISOString().slice(0, 10);
  const start = localMidnightUtc(targetYmd, zone);
  const nextDay = new Date(target.getTime() + 86400000).toISOString().slice(0, 10);
  const end = localMidnightUtc(nextDay, zone);
  return [start.toISOString(), end.toISOString()];
}

/**
 * Get [startUtcIso, endUtcIso] for a range of `days` calendar days ending
 * now (inclusive of today). e.g. `getLocalWindowBounds(tz, 7)` → last 7 days.
 */
export function getLocalWindowBounds(
  tz: string | null | undefined,
  days: number
): [string, string] {
  const [_startToday, endToday] = getLocalDayBounds(tz, 0);
  const [startBack] = getLocalDayBounds(tz, -(days - 1));
  return [startBack, endToday];
}

/**
 * Given a YYYY-MM-DD date from a client-facing date picker and a timezone,
 * return the UTC start/end bounds so `WHERE timestamp >= start AND < end`
 * covers that local day exactly.
 */
export function getLocalDateRangeBounds(
  startYmd: string,
  endYmd: string,
  tz: string | null | undefined
): [string, string] {
  const zone = resolveTimezone(tz);
  const start = localMidnightUtc(startYmd, zone);
  // end is exclusive: start of (end + 1 day)
  const [y, m, d] = endYmd.split('-').map(Number);
  const nextDayUtc = new Date(Date.UTC(y, m - 1, d) + 86400000).toISOString().slice(0, 10);
  const end = localMidnightUtc(nextDayUtc, zone);
  return [start.toISOString(), end.toISOString()];
}
