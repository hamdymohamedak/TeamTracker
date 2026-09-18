import type { ChatResponse } from '../types.js';

export async function handleEmployeeQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const sql = `
    SELECT 
      e.name,
      e.department,
      COUNT(DISTINCT DATE(a.timestamp)) as days_active,
      SUM(CASE 
        WHEN a.app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                       'lockscreen', 'screensaver', 'securityagent', 
                                       'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
        AND a.app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
        AND a.category != 'break_idle'
        AND a.is_idle = 0
        THEN a.duration_seconds 
        ELSE 0 
      END) / 3600 as total_hours,
      AVG(CASE 
        WHEN a.app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                       'lockscreen', 'screensaver', 'securityagent', 
                                       'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
        AND a.app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
        AND a.category != 'break_idle'
        AND a.is_idle = 0
        THEN a.productivity_score 
        ELSE NULL 
      END) as avg_productivity,
      SUM(CASE 
        WHEN a.is_suspicious = 1 
        AND a.app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                     'lockscreen', 'screensaver', 'securityagent', 
                                     'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
        AND a.app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
        AND a.category != 'break_idle'
        AND a.is_idle = 0
        THEN 1 
        ELSE 0 
      END) as suspicious_count
    FROM employees e
    LEFT JOIN activities a ON e.id = a.employee_id AND a.org_id = e.org_id
    WHERE e.org_id = ?
    AND a.timestamp > datetime('now', '-7 days')
    GROUP BY e.id
    ORDER BY total_hours DESC
  `;

  const data = await db.all(sql, [orgId]);

  const answer =
    `**Employee Activity Summary (Last 7 Days)**\n\n` +
    data
      .map((row: any) => {
        const status = row.suspicious_count > 5 ? '⚠️' : '✅';
        const hours = Math.round(row.total_hours * 10) / 10;
        const productivity = Math.round(row.avg_productivity);
        return `${status} **${row.name}** (${row.department})\n   ${hours}h tracked • ${productivity}% productivity • ${row.suspicious_count} flags`;
      })
      .join('\n\n');

  return {
    answer,
    sql,
    data,
    suggestions: [
      'Who worked the most hours?',
      'Show suspicious activity',
      'Department comparison',
    ],
  };
}
