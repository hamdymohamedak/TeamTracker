import type { ChatResponse } from '../types.js';
import { extractEmployeeName, extractTimeframe } from '../helpers.js';

export async function handleTimeSpentQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const employee = await extractEmployeeName(question, db, orgId);
  const timeframe = extractTimeframe(question);

  let sql: string;
  let params: any[];

  if (employee) {
    sql = `
      SELECT 
        app_name,
        SUM(duration_seconds) / 3600 as hours,
        COUNT(*) as sessions
      FROM activities
      WHERE employee_id = ?
      AND org_id = ?
      AND timestamp > datetime('now', ?)
      AND app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                  'lockscreen', 'screensaver', 'securityagent', 
                                  'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
      AND app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
      AND app_name COLLATE NOCASE NOT LIKE '%lock screen%'
      AND app_name COLLATE NOCASE NOT LIKE '%screensaver%'
      AND category != 'break_idle'
      AND is_idle = 0
      GROUP BY app_name
      ORDER BY hours DESC
      LIMIT 10
    `;
    params = [employee.id, orgId, `-${timeframe.days} days`];
  } else {
    sql = `
      SELECT 
        e.name as employee_name,
        SUM(CASE 
          WHEN a.app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                         'lockscreen', 'screensaver', 'securityagent', 
                                         'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
          AND a.app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
          AND a.category != 'break_idle'
          AND a.is_idle = 0
          THEN a.duration_seconds 
          ELSE 0 
        END) / 3600 as hours
      FROM activities a
      JOIN employees e ON a.employee_id = e.id AND e.org_id = a.org_id
      WHERE a.org_id = ?
      AND a.timestamp > datetime('now', ?)
      GROUP BY a.employee_id
      ORDER BY hours DESC
    `;
    params = [orgId, `-${timeframe.days} days`];
  }

  const data = await db.all(sql, params);

  let answer: string;
  if (employee) {
    const totalHours = data.reduce(
      (sum: number, row: any) => sum + row.hours,
      0,
    );
    const topApps = data
      .slice(0, 3)
      .map(
        (row: any) =>
          `${row.app_name} (${Math.round(row.hours * 10) / 10}h)`,
      )
      .join(', ');
    answer = `${employee.name} spent ${Math.round(totalHours * 10) / 10} hours on the computer ${timeframe.label}. Top apps: ${topApps}.`;
  } else {
    answer =
      `Time spent by employee ${timeframe.label}:\n\n` +
      data
        .map(
          (row: any) =>
            `• ${row.employee_name}: ${Math.round(row.hours * 10) / 10} hours`,
        )
        .join('\n');
  }

  return {
    answer,
    sql,
    data,
    suggestions: [
      'Show productivity scores',
      'What apps were used most?',
      'Any suspicious activity?',
    ],
  };
}
