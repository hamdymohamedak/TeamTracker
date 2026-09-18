import type { ChatResponse } from '../types.js';
import { extractEmployeeName } from '../helpers.js';

export async function handleBurnoutQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const employee = await extractEmployeeName(question, db, orgId);

  const sql = `
    SELECT 
      e.name,
      e.department,
      SUM(CASE WHEN a.timestamp > datetime('now', '-7 days') THEN a.duration_seconds ELSE 0 END) / 3600 as recent_hours,
      SUM(CASE WHEN a.timestamp <= datetime('now', '-7 days') AND a.timestamp > datetime('now', '-14 days') THEN a.duration_seconds ELSE 0 END) / 3600 as previous_hours,
      AVG(CASE WHEN a.timestamp > datetime('now', '-7 days') THEN a.productivity_score END) as recent_score,
      AVG(CASE WHEN a.timestamp <= datetime('now', '-7 days') AND a.timestamp > datetime('now', '-14 days') THEN a.productivity_score END) as previous_score
    FROM employees e
    JOIN activities a ON e.id = a.employee_id AND a.org_id = e.org_id
    WHERE e.org_id = ?
    AND a.timestamp > datetime('now', '-14 days')
    ${employee ? 'AND e.id = ?' : ''}
    GROUP BY e.id
    ${employee ? '' : 'HAVING recent_hours > 45 OR (recent_score < previous_score - 15)'}
    ORDER BY recent_hours DESC
  `;

  const params = employee ? [orgId, employee.id] : [orgId];
  const data = await db.all(sql, params);

  if (data.length === 0) {
    return {
      answer: employee
        ? `**Good news!** ${employee.name} doesn't show burnout indicators.`
        : `**Good news!** No employees show signs of burnout.`,
      suggestions: [
        'Show overtime workers',
        'Who has capacity?',
        'Team wellness check',
      ],
    };
  }

  let answer = employee
    ? `**${employee.name}'s Burnout Risk Assessment**\n\n`
    : `**Employees at Risk of Burnout**\n\n`;

  data.forEach((row: any) => {
    const scoreChange = row.previous_score
      ? Math.round(row.recent_score - row.previous_score)
      : 0;

    const riskLevel =
      row.recent_hours > 50 && row.recent_score < 50
        ? '🔴 HIGH'
        : row.recent_hours > 45 || scoreChange < -20
          ? '🟠 MEDIUM'
          : '🟡 LOW';

    answer += `${riskLevel} **${row.name}**\n`;
    answer += `   • Hours: ${Math.round(row.previous_hours || 0)}h → **${Math.round(row.recent_hours)}h**\n`;
    answer += `   • Productivity: ${Math.round(row.previous_score || 0)}% → **${Math.round(row.recent_score)}%**\n\n`;
  });

  answer += `**Recommendations:** Check in with these employees, consider redistributing tasks, encourage breaks.`;

  return {
    answer,
    suggestions: [
      'Redistribute workload',
      'Who has capacity?',
      'Show overtime trends',
    ],
  };
}
