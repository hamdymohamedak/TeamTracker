import type { ChatResponse } from '../types.js';
import { extractTimeframe } from '../helpers.js';

export async function handleOvertimeQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const timeframe = extractTimeframe(question);
  const threshold = 40;

  const sql = `
    SELECT
      e.name,
      e.department,
      SUM(a.duration_seconds) / 3600 as total_hours,
      AVG(a.productivity_score) as avg_score,
      COUNT(DISTINCT DATE(a.timestamp)) as days_worked,
      MAX(a.timestamp) as last_activity
    FROM employees e
    JOIN activities a ON e.id = a.employee_id AND a.org_id = e.org_id
    WHERE e.org_id = ?
    AND a.timestamp > datetime('now', ?)
    GROUP BY e.id
    HAVING total_hours > ?
    ORDER BY total_hours DESC
  `;

  const data = await db.all(sql, [orgId, `-${timeframe.days} days`, threshold]);

  if (data.length === 0) {
    return {
      answer: `No one is working excessive overtime ${timeframe.label}. All employees are within normal working hours.`,
      suggestions: [
        'Who has capacity for more work?',
        'Show burnout risk',
        'Team workload balance',
      ],
    };
  }

  let answer = `**Employees Working Overtime ${timeframe.label}**\n\n`;

  data.forEach((row: any) => {
    const overtime = Math.round((row.total_hours - threshold) * 10) / 10;
    const emoji = row.avg_score < 50 ? '⚠️' : '💪';
    answer += `${emoji} **${row.name}** (${row.department})\n`;
    answer += `   • Total hours: **${Math.round(row.total_hours * 10) / 10}h** (${overtime}h over)\n`;
    answer += `   • Days worked: ${row.days_worked}\n`;
    answer += `   • Productivity: ${Math.round(row.avg_score)}%\n`;
    answer += `   • Last active: ${new Date(row.last_activity).toLocaleDateString()}\n\n`;
  });

  answer += `**Note:** High overtime with low productivity may indicate burnout. Consider redistributing workload.`;

  return {
    answer,
    suggestions: [
      'Check for burnout risk',
      'Who has capacity?',
      'Workload distribution',
    ],
  };
}
