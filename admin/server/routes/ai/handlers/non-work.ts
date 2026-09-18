import type { ChatResponse } from '../types.js';
import { extractEmployeeName, extractTimeframe } from '../helpers.js';

export async function handleNonWorkQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const employee = await extractEmployeeName(question, db, orgId);
  const timeframe = extractTimeframe(question);

  const unproductiveCategories = [
    'entertainment',
    'social_media',
    'shopping_personal',
  ];
  const categoryFilter = unproductiveCategories
    .map((c) => `category = '${c}'`)
    .join(' OR ');

  let sql: string;
  let params: any[];

  if (employee) {
    sql = `
      SELECT
        app_name,
        category_name,
        SUM(duration_seconds) / 3600 as hours,
        COUNT(*) as sessions
      FROM activities
      WHERE employee_id = ?
      AND org_id = ?
      AND (${categoryFilter})
      AND timestamp > datetime('now', ?)
      GROUP BY app_name
      ORDER BY hours DESC
      LIMIT 10
    `;
    params = [employee.id, orgId, `-${timeframe.days} days`];
  } else {
    sql = `
      SELECT
        e.name as employee_name,
        SUM(a.duration_seconds) / 3600 as hours
      FROM activities a
      JOIN employees e ON a.employee_id = e.id AND e.org_id = a.org_id
      WHERE a.org_id = ?
      AND (${categoryFilter})
      AND a.timestamp > datetime('now', ?)
      GROUP BY a.employee_id
      ORDER BY hours DESC
    `;
    params = [orgId, `-${timeframe.days} days`];
  }

  const data = await db.all(sql, params);

  if (data.length === 0) {
    return {
      answer: `Great! No significant non-work activity detected ${timeframe.label}${employee ? ` for ${employee.name}` : ''}.`,
      suggestions: [
        'Show productivity leaders',
        'Who deserves recognition?',
        'Team performance',
      ],
    };
  }

  let answer = '';

  if (employee) {
    const totalWasted = data.reduce(
      (sum: number, row: any) => sum + row.hours,
      0,
    );
    answer = `**${employee.name}'s Non-Work Activity ${timeframe.label}**\n\n`;
    answer += `Total time on non-work apps: **${Math.round(totalWasted * 10) / 10} hours**\n\n`;

    data.forEach((row: any) => {
      const emoji =
        row.category_name === 'entertainment'
          ? '🎮'
          : row.category_name === 'social_media'
            ? '📱'
            : '🛒';
      answer += `${emoji} **${row.app_name}**: ${Math.round(row.hours * 10) / 10}h (${row.sessions} times)\n`;
    });

    if (totalWasted > 5) {
      answer += `\n⚠️ **Concern:** Over 5 hours on non-work activities. Consider discussing focus time expectations.`;
    }
  } else {
    answer = `**Non-Work Time by Employee ${timeframe.label}**\n\n`;
    data.forEach((row: any, idx: number) => {
      answer += `${idx + 1}. **${row.employee_name}**: ${Math.round(row.hours * 10) / 10} hours\n`;
    });
  }

  return {
    answer,
    suggestions: [
      'What can they improve?',
      'Show their productive time',
      'Compare to team average',
    ],
  };
}
