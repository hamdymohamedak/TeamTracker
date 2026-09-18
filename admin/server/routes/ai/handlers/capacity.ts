import type { ChatResponse } from '../types.js';
import { extractTimeframe } from '../helpers.js';

export async function handleCapacityQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const timeframe = extractTimeframe(question);
  const standardHours = timeframe.days * 8;

  const sql = `
    SELECT
      e.name,
      e.department,
      SUM(a.duration_seconds) / 3600 as hours_worked,
      AVG(a.productivity_score) as avg_score
    FROM employees e
    LEFT JOIN activities a ON e.id = a.employee_id AND a.org_id = e.org_id
      AND a.timestamp > datetime('now', ?)
    WHERE e.org_id = ?
    GROUP BY e.id
    ORDER BY hours_worked ASC
  `;

  const data = await db.all(sql, [`-${timeframe.days} days`, orgId]);

  let answer = `**Employee Capacity Analysis ${timeframe.label}**\n\n`;
  answer += `Standard: **${standardHours} hours**\n\n`;

  const available = data.filter(
    (e: any) => e.hours_worked < standardHours * 0.8,
  );
  const overloaded = data.filter(
    (e: any) => e.hours_worked > standardHours,
  );

  if (available.length > 0) {
    answer += `**🟢 Available:**\n`;
    available.forEach((row: any) => {
      const remaining =
        Math.round((standardHours - row.hours_worked) * 10) / 10;
      answer += `• **${row.name}**: ${remaining}h available\n`;
    });
    answer += '\n';
  }

  if (overloaded.length > 0) {
    answer += `**🔴 Overloaded:**\n`;
    overloaded.forEach((row: any) => {
      answer += `• **${row.name}**: ${Math.round(row.hours_worked * 10) / 10}h\n`;
    });
  }

  if (available.length > 0) {
    answer += `\n**Recommendation:** Give new work to **${available[0].name}**.`;
  }

  return {
    answer,
    suggestions: [
      'Show burnout risk',
      'Redistribute workload',
      'Who is most efficient?',
    ],
  };
}
