import type { ChatResponse } from '../types.js';
import { extractEmployeeName, extractTimeframe } from '../helpers.js';

export async function handleSpecificAppQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const employee = await extractEmployeeName(question, db, orgId);
  const timeframe = extractTimeframe(question);

  let appName = '';
  let appDisplay = '';

  if (question.includes('youtube')) {
    appName = 'YouTube';
    appDisplay = 'YouTube';
  } else if (
    question.includes('email') ||
    question.includes('gmail') ||
    question.includes('outlook')
  ) {
    appName = 'Mail';
    appDisplay = 'email';
  } else if (question.includes('slack')) {
    appName = 'Slack';
    appDisplay = 'Slack';
  } else if (
    question.includes('chrome') ||
    question.includes('safari') ||
    question.includes('browser')
  ) {
    appName = 'Chrome';
    appDisplay = 'browser';
  }

  let sql: string;
  let params: any[];

  if (employee) {
    sql = `
      SELECT 
        app_name,
        SUM(duration_seconds) / 3600 as hours,
        COUNT(*) as sessions,
        AVG(productivity_score) as avg_score,
        window_title
      FROM activities
      WHERE employee_id = ?
      AND org_id = ?
      AND (LOWER(app_name) LIKE LOWER(?))
      AND timestamp > datetime('now', ?)
      GROUP BY app_name
      ORDER BY hours DESC
    `;
    params = [employee.id, orgId, `%${appName}%`, `-${timeframe.days} days`];
  } else {
    sql = `
      SELECT 
        e.name as employee_name,
        a.app_name,
        SUM(a.duration_seconds) / 3600 as hours,
        COUNT(*) as sessions,
        AVG(a.productivity_score) as avg_score
      FROM activities a
      JOIN employees e ON a.employee_id = e.id AND e.org_id = a.org_id
      WHERE LOWER(a.app_name) LIKE LOWER(?)
      AND a.org_id = ?
      AND a.timestamp > datetime('now', ?)
      GROUP BY a.employee_id, a.app_name
      ORDER BY hours DESC
    `;
    params = [`%${appName}%`, orgId, `-${timeframe.days} days`];
  }

  const data = await db.all(sql, params);

  if (data.length === 0) {
    return {
      answer: `No ${appDisplay} activity found${employee ? ` for ${employee.name}` : ''} ${timeframe.label}.`,
      suggestions: [
        'Show all apps used',
        'What are they doing instead?',
        'Weekly summary',
      ],
    };
  }

  let answer = '';

  if (employee) {
    const totalHours = data.reduce(
      (sum: number, row: any) => sum + row.hours,
      0,
    );
    const avgScore =
      data.reduce((sum: number, row: any) => sum + row.avg_score, 0) /
      data.length;

    answer = `**${employee.name}'s ${appDisplay} Usage (${timeframe.label})**\n\n`;
    answer += `• Total Time: ${Math.round(totalHours * 10) / 10} hours\n`;
    answer += `• Sessions: ${data.reduce((sum: number, row: any) => sum + row.sessions, 0)}\n`;
    answer += `• Avg Productivity Score: ${Math.round(avgScore)}%\n\n`;

    if (appName === 'YouTube' && totalHours > 2) {
      answer += `⚠️ **High YouTube usage detected.** Consider setting time limits or using website blockers during focus hours.`;
    } else if (appName === 'Mail' || appName === 'Slack') {
      answer += `💡 **Communication apps** are essential, but batch-checking emails/messages 2-3 times per day can improve focus.`;
    }
  } else {
    answer = `**${appDisplay} Usage by Employee (${timeframe.label})**\n\n`;
    data.forEach((row: any, idx: number) => {
      answer += `${idx + 1}. **${row.employee_name}**: ${Math.round(row.hours * 10) / 10}h (${row.sessions} sessions, ${Math.round(row.avg_score)}% productive)\n`;
    });
  }

  return {
    answer,
    suggestions: [
      'Compare to last week',
      'What else are they using?',
      'Productivity tips',
    ],
  };
}
