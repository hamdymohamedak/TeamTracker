import type { ChatResponse } from '../types.js';
import { extractEmployeeName, extractTimeframe } from '../helpers.js';

export async function handleImprovementQuery(
  question: string,
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const employee = await extractEmployeeName(question, db, orgId);
  const timeframe = extractTimeframe(question);

  if (!employee) {
    return {
      answer:
        "I'd be happy to help! To give personalized improvement suggestions, could you tell me which employee you'd like advice for? For example: 'What can Mohammed do better?'",
      suggestions: [
        'What can Mohammed do better?',
        'How to improve productivity?',
        'Time management tips',
      ],
    };
  }

  const statsSql = `
    SELECT 
      AVG(productivity_score) as avg_score,
      SUM(CASE WHEN productivity_level = 'productive' THEN duration_seconds ELSE 0 END) / 3600 as productive_hours,
      SUM(CASE WHEN productivity_level = 'unproductive' THEN duration_seconds ELSE 0 END) / 3600 as unproductive_hours,
      SUM(CASE WHEN productivity_level = 'idle' THEN duration_seconds ELSE 0 END) / 3600 as idle_hours,
      SUM(duration_seconds) / 3600 as total_hours,
      COUNT(DISTINCT CASE WHEN is_suspicious = 1 THEN id END) as suspicious_count,
      COUNT(*) as total_activities
    FROM activities
    WHERE employee_id = ?
    AND org_id = ?
    AND timestamp > datetime('now', ?)
  `;

  const stats = await db.get(statsSql, [
    employee.id,
    orgId,
    `-${timeframe.days} days`,
  ]);

  const appsSql = `
    SELECT 
      app_name,
      SUM(duration_seconds) / 3600 as hours,
      AVG(productivity_score) as avg_score
    FROM activities
    WHERE employee_id = ?
    AND org_id = ?
    AND timestamp > datetime('now', ?)
    AND (productivity_level = 'unproductive' OR productivity_level = 'idle')
    GROUP BY app_name
    ORDER BY hours DESC
    LIMIT 5
  `;

  const unproductiveApps = await db.all(appsSql, [
    employee.id,
    orgId,
    `-${timeframe.days} days`,
  ]);

  const categorySql = `
    SELECT 
      category_name,
      SUM(duration_seconds) / 3600 as hours,
      AVG(productivity_score) as avg_score
    FROM activities
    WHERE employee_id = ?
    AND org_id = ?
    AND timestamp > datetime('now', ?)
    GROUP BY category_name
    ORDER BY hours DESC
  `;

  await db.all(categorySql, [employee.id, orgId, `-${timeframe.days} days`]);

  let answer = `**${employee.name}'s Productivity Analysis (${timeframe.label})**\n\n`;

  const productivePct =
    stats.total_hours > 0
      ? Math.round((stats.productive_hours / stats.total_hours) * 100)
      : 0;
  const unproductivePct =
    stats.total_hours > 0
      ? Math.round((stats.unproductive_hours / stats.total_hours) * 100)
      : 0;
  const idlePct =
    stats.total_hours > 0
      ? Math.round((stats.idle_hours / stats.total_hours) * 100)
      : 0;

  answer += `**Current Stats:**\n`;
  answer += `• Productivity Score: ${Math.round(stats.avg_score)}%\n`;
  answer += `• Productive Time: ${productivePct}% (${Math.round(stats.productive_hours * 10) / 10}h)\n`;
  answer += `• Unproductive Time: ${unproductivePct}% (${Math.round(stats.unproductive_hours * 10) / 10}h)\n`;
  answer += `• Idle Time: ${idlePct}% (${Math.round(stats.idle_hours * 10) / 10}h)\n\n`;

  const recommendations: string[] = [];

  if (stats.avg_score < 50) {
    recommendations.push(
      '**Focus Improvement Needed:** Try using website blockers during work hours to reduce distractions',
    );
  }

  if (idlePct > 30) {
    recommendations.push(
      '**High Idle Time:** Consider taking structured breaks (Pomodoro technique) instead of sporadic idle time',
    );
  }

  if (unproductiveApps.length > 0) {
    const topTimeWaster = unproductiveApps[0];
    recommendations.push(
      `**Top Time Waster:** ${topTimeWaster.app_name} (${Math.round(topTimeWaster.hours * 10) / 10}h). Try limiting this to specific times of day`,
    );
  }

  if (stats.suspicious_count > 10) {
    recommendations.push(
      '**Activity Patterns:** High number of flagged activities. Review if these are work-related or need addressing',
    );
  }

  if (stats.avg_score > 70) {
    recommendations.unshift(
      '**Great work!** Productivity score is above average. Keep it up! 🎉',
    );
  } else if (productivePct > 60) {
    recommendations.unshift(
      '**Good progress!** More than half the time is productive. Small tweaks can help optimize further',
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      '**Tracking Well:** Data shows balanced activity. Continue monitoring for patterns',
    );
  }

  answer += `**Recommendations:**\n` + recommendations.join('\n\n');

  return {
    answer,
    suggestions: [
      'Show time breakdown',
      'What apps are used most?',
      'Compare to team average',
    ],
  };
}
