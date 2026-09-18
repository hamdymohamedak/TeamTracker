import type { ChatResponse } from '../types.js';
import { extractTimeframe } from '../helpers.js';

export async function handleSlackingQuery(
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
      SUM(CASE WHEN a.productivity_level = 'idle' THEN a.duration_seconds ELSE 0 END) / 3600 as idle_hours,
      SUM(CASE WHEN a.productivity_level = 'unproductive' THEN a.duration_seconds ELSE 0 END) / 3600 as unproductive_hours,
      SUM(a.duration_seconds) / 3600 as total_hours,
      COUNT(CASE WHEN a.is_idle = 1 THEN 1 END) as idle_count
    FROM employees e
    JOIN activities a ON e.id = a.employee_id AND a.org_id = e.org_id
    WHERE e.org_id = ?
    AND a.timestamp > datetime('now', ?)
    GROUP BY e.id
    HAVING avg_score < 40 OR idle_hours > 2
    ORDER BY avg_score ASC, idle_hours DESC
  `;

  const data = await db.all(sql, [orgId, `-${timeframe.days} days`]);

  if (data.length === 0) {
    return {
      answer: `**Good news!** No one appears to be slacking off ${timeframe.label}. All employees are maintaining reasonable productivity levels.`,
      suggestions: [
        'Who is most productive?',
        'Show overtime workers',
        'Team efficiency trends',
      ],
    };
  }

  let answer = `**Employees with Low Activity ${timeframe.label}**\n\n`;

  data.forEach((row: any) => {
    const emoji =
      row.avg_score < 20 ? '🔴' : row.avg_score < 40 ? '🟠' : '🟡';
    answer += `${emoji} **${row.name}** (${row.department})\n`;
    answer += `   • Productivity: ${Math.round(row.avg_score)}%\n`;
    answer += `   • Idle time: ${Math.round(row.idle_hours * 10) / 10}h\n`;
    answer += `   • Unproductive: ${Math.round(row.unproductive_hours * 10) / 10}h\n`;
    answer += `   • Total tracked: ${Math.round(row.total_hours * 10) / 10}h\n\n`;
  });

  answer += `**Recommendation:** Consider having a 1-on-1 with these employees to understand if there are blockers or distractions affecting their work.`;

  return {
    answer,
    suggestions: [
      'What can they improve?',
      'Compare to last week',
      'Show their app usage',
    ],
  };
}
