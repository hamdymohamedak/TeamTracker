import type { ChatResponse } from '../types.js';
import { extractTimeframe } from '../helpers.js';

export async function handleTopPerformerQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const timeframe = extractTimeframe(question);

  const sql = `
    SELECT
      e.name,
      e.department,
      AVG(a.productivity_score) as avg_score,
      SUM(a.duration_seconds) / 3600 as total_hours
    FROM employees e
    JOIN activities a ON e.id = a.employee_id AND a.org_id = e.org_id
    WHERE e.org_id = ?
    AND a.timestamp > datetime('now', ?)
    GROUP BY e.id
    HAVING avg_score > 60 AND total_hours > 10
    ORDER BY avg_score DESC
    LIMIT 5
  `;

  const data = await db.all(sql, [orgId, `-${timeframe.days} days`]);

  if (data.length === 0) {
    return {
      answer: `No clear top performers identified ${timeframe.label}.`,
      suggestions: [
        'Show all employees',
        'Who is improving?',
        'Team productivity overview',
      ],
    };
  }

  let answer = `**🏆 Top Performers ${timeframe.label}**\n\n`;

  data.forEach((row: any, idx: number) => {
    const medal =
      idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '•';
    answer += `${medal} **${row.name}** (${row.department}): ${Math.round(row.avg_score)}% productivity, ${Math.round(row.total_hours)}h\n`;
  });

  return {
    answer,
    suggestions: [
      'What makes them successful?',
      'Show their work patterns',
      'Compare to others',
    ],
  };
}
