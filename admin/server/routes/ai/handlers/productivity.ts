import type { ChatResponse } from '../types.js';
import { extractTimeframe } from '../helpers.js';

export async function handleProductivityQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const timeframe = extractTimeframe(question);

  const sql = `
    SELECT
      e.name as employee_name,
      AVG(CASE 
        WHEN a.app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                       'lockscreen', 'screensaver', 'securityagent', 
                                       'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
        AND a.app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
        AND a.category != 'break_idle'
        AND a.is_idle = 0
        THEN a.productivity_score 
        ELSE NULL 
      END) as avg_score,
      SUM(CASE 
        WHEN a.productivity_level = 'productive' 
        AND a.app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                     'lockscreen', 'screensaver', 'securityagent', 
                                     'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
        AND a.app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
        AND a.category != 'break_idle'
        AND a.is_idle = 0
        THEN a.duration_seconds 
        ELSE 0 
      END) / 3600 as productive_hours,
      SUM(CASE 
        WHEN a.app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                       'lockscreen', 'screensaver', 'securityagent', 
                                       'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
        AND a.app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
        AND a.category != 'break_idle'
        AND a.is_idle = 0
        THEN a.duration_seconds 
        ELSE 0 
      END) / 3600 as total_hours
    FROM activities a
    JOIN employees e ON a.employee_id = e.id AND e.org_id = a.org_id
    WHERE a.org_id = ?
    AND a.timestamp > datetime('now', ?)
    GROUP BY a.employee_id
    ORDER BY avg_score DESC
  `;

  const data = await db.all(sql, [orgId, `-${timeframe.days} days`]);

  const answer =
    `Productivity rankings ${timeframe.label}:\n\n` +
    data
      .map((row: any, idx: number) => {
        const percentage =
          row.total_hours > 0
            ? Math.round((row.productive_hours / row.total_hours) * 100)
            : 0;
        const medal =
          idx === 0
            ? '🥇'
            : idx === 1
              ? '🥈'
              : idx === 2
                ? '🥉'
                : '•';
        return `${medal} ${row.employee_name}: ${Math.round(row.avg_score)}% score, ${percentage}% productive time`;
      })
      .join('\n');

  return {
    answer,
    sql,
    data,
    suggestions: [
      'Who was least productive?',
      'Show time wasters',
      'Repetitive task opportunities',
    ],
  };
}
