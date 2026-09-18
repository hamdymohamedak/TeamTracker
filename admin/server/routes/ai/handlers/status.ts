import type { ChatResponse } from '../types.js';
import { extractEmployeeName, extractTimeframe } from '../helpers.js';
import { handleGeneralQuery } from './general.js';

export async function handleStatusQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const employee = await extractEmployeeName(question, db, orgId);
  const timeframe = extractTimeframe(question);

  if (!employee) {
    return handleGeneralQuery(db, orgId);
  }

  const todaySql = `
    SELECT 
      AVG(productivity_score) as avg_score,
      SUM(CASE WHEN productivity_level = 'productive' THEN duration_seconds ELSE 0 END) / 3600 as productive_hours,
      SUM(duration_seconds) / 3600 as total_hours,
      COUNT(*) as activities,
      MAX(timestamp) as last_activity
    FROM activities
    WHERE employee_id = ?
    AND org_id = ?
    AND timestamp > datetime('now', ?)
  `;

  const today = await db.get(todaySql, [
    employee.id,
    orgId,
    `-${timeframe.days} days`,
  ]);

  const currentSql = `
    SELECT app_name, window_title, category_name, productivity_score
    FROM activities
    WHERE employee_id = ?
    AND org_id = ?
    ORDER BY timestamp DESC
    LIMIT 1
  `;

  const current = await db.get(currentSql, [employee.id, orgId]);

  const avgSql = `
    SELECT AVG(productivity_score) as overall_avg
    FROM activities
    WHERE employee_id = ?
    AND org_id = ?
    AND timestamp > datetime('now', '-30 days')
  `;

  const overall = await db.get(avgSql, [employee.id, orgId]);

  let answer = `**${employee.name}'s Status (${timeframe.label})**\n\n`;

  if (today.total_hours === 0) {
    answer += `📭 **No activity recorded** for ${timeframe.label}.\n\n`;
    answer += `The desktop tracker may not be running. Ask them to start the TeamTracker tracker app.`;
  } else {
    const productivePct =
      today.total_hours > 0
        ? Math.round((today.productive_hours / today.total_hours) * 100)
        : 0;
    const vsAverage = today.avg_score - overall.overall_avg;
    const trend =
      vsAverage > 5
        ? '📈 Above'
        : vsAverage < -5
          ? '📉 Below'
          : '➡️ On par with';

    answer += `**Today's Performance:**\n`;
    answer += `• Productivity Score: ${Math.round(today.avg_score)}%\n`;
    answer += `• Productive Time: ${productivePct}% (${Math.round(today.productive_hours * 10) / 10}h of ${Math.round(today.total_hours * 10) / 10}h total)\n`;
    answer += `• Activities Tracked: ${today.activities}\n`;
    answer += `• ${trend} their 30-day average (${Math.round(overall.overall_avg)}%)\n\n`;

    if (current) {
      const statusEmoji =
        current.productivity_score > 70
          ? '🟢'
          : current.productivity_score > 40
            ? '🟡'
            : '🔴';
      answer += `**Currently:** ${statusEmoji} ${current.app_name} - ${current.window_title.substring(0, 50)}${current.window_title.length > 50 ? '...' : ''}`;
    }
  }

  return {
    answer,
    suggestions: [
      'What can they improve?',
      'Show weekly trend',
      'Compare to team',
    ],
  };
}
