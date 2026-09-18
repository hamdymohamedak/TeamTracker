import type { ChatResponse } from '../types.js';

export async function handleGeneralQuery(
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const sql = `
    SELECT 
      COUNT(DISTINCT employee_id) as active_employees,
      SUM(CASE 
        WHEN app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                     'lockscreen', 'screensaver', 'securityagent', 
                                     'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
        AND app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
        AND category != 'break_idle'
        AND is_idle = 0
        THEN duration_seconds 
        ELSE 0 
      END) / 3600 as total_hours,
      AVG(CASE 
        WHEN app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                     'lockscreen', 'screensaver', 'securityagent', 
                                     'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
        AND app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
        AND category != 'break_idle'
        AND is_idle = 0
        THEN productivity_score 
        ELSE NULL 
      END) as avg_productivity,
      SUM(CASE 
        WHEN is_suspicious = 1 
        AND app_name COLLATE NOCASE NOT IN ('loginwindow', 'window server', 'kernel', 'system', 
                                   'lockscreen', 'screensaver', 'securityagent', 
                                   'usernotificationcenter', 'finder', 'dock', 'launchd', 'idle')
        AND app_name COLLATE NOCASE NOT LIKE '%loginwindow%'
        AND category != 'break_idle'
        AND is_idle = 0
        THEN 1 
        ELSE 0 
      END) as suspicious_activities
    FROM activities
    WHERE org_id = ?
    AND timestamp > datetime('now', '-7 days')
  `;

  const data = await db.all(sql, [orgId]);
  const row = data[0];

  const employees = await db.all(
    'SELECT name FROM employees WHERE is_active = 1 AND org_id = ? ORDER BY name',
    [orgId],
  );
  const employeeNames = employees.map((e: any) => e.name);

  const suggestions: string[] = [];

  if (employeeNames.length > 0) {
    const randomEmployee =
      employeeNames[Math.floor(Math.random() * employeeNames.length)];
    suggestions.push(`How is ${randomEmployee} doing?`);
  }

  if (row.active_employees < 2) {
    suggestions.push('Show employee setup guide');
  }

  if (row.total_hours < 10) {
    suggestions.push('Why is tracked time low?');
  } else {
    suggestions.push('Who worked the most hours?');
  }

  suggestions.push('Show productivity rankings');
  suggestions.push('What apps are used most?');

  const answer =
    `**📊 Weekly Team Summary**\n\n` +
    `• **${row.active_employees}** employees actively tracked\n` +
    `• **${Math.round(row.total_hours * 10) / 10}** total hours logged\n` +
    `• **${Math.round(row.avg_productivity)}%** average productivity score\n` +
    `• **${row.suspicious_activities}** activities flagged for review\n\n` +
    `**Try asking:**\n` +
    `• "How is [name] doing today?"\n` +
    `• "What can [name] do better?"\n` +
    `• "Who spent the most time on YouTube?"\n` +
    `• "What are the automation opportunities?"`;

  return {
    answer,
    sql,
    data,
    suggestions: suggestions.slice(0, 3),
  };
}
