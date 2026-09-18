import type { ChatResponse } from '../types.js';
import { extractTimeframe } from '../helpers.js';

export async function handleAppQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const timeframe = extractTimeframe(question);

  const sql = `
    SELECT
      app_name,
      SUM(duration_seconds) / 3600 as hours,
      COUNT(DISTINCT employee_id) as users,
      AVG(productivity_score) as avg_score
    FROM activities
    WHERE org_id = ?
    AND timestamp > datetime('now', ?)
    AND app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                'lockscreen', 'screensaver', 'securityagent', 
                                'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
    AND app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
    AND app_name COLLATE NOCASE NOT LIKE '%lock screen%'
    AND app_name COLLATE NOCASE NOT LIKE '%screensaver%'
    AND app_name COLLATE NOCASE NOT LIKE '%securityagent%'
    AND app_name COLLATE NOCASE NOT LIKE '%usernotification%'
    AND category != 'break_idle'
    AND is_idle = 0
    GROUP BY app_name
    ORDER BY hours DESC
    LIMIT 10
  `;

  const data = await db.all(sql, [orgId, `-${timeframe.days} days`]);

  const answer =
    `**Top 10 Apps ${timeframe.label}**\n\n` +
    data
      .map((row: any, idx: number) => {
        const medal =
          idx === 0
            ? '🥇'
            : idx === 1
              ? '🥈'
              : idx === 2
                ? '🥉'
                : '•';
        const scoreEmoji =
          row.avg_score > 70
            ? '🟢'
            : row.avg_score > 40
              ? '🟡'
              : '🔴';
        return `${medal} **${row.app_name}**: ${Math.round(row.hours * 10) / 10}h (${row.users} users) ${scoreEmoji} ${Math.round(row.avg_score)}%`;
      })
      .join('\n');

  return {
    answer,
    sql,
    data,
    suggestions: [
      'Show distracting apps',
      'Most productive apps',
      'App usage trends',
    ],
  };
}
