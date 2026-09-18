import type { ChatResponse } from '../types.js';
import { detectRepetitivePatterns } from '../../../ai-analytics.js';

export async function handleRepetitiveTasksQuery(
  db: any,
  orgId: string,
): Promise<ChatResponse> {
  const patterns = await detectRepetitivePatterns(undefined, 14, orgId);

  const validPatterns = patterns.filter((p) => {
    if (p.totalTimeHours < 0.5) return false;
    if (
      p.description.includes('→') &&
      p.description
        .split('→')
        .every(
          (app) =>
            app.trim() === p.description.split('→')[0].trim(),
        )
    )
      return false;
    return true;
  });

  if (validPatterns.length === 0) {
    const dataCheck = await db.get(
      `
      SELECT 
        COUNT(DISTINCT employee_id) as employee_count,
        COUNT(*) as activity_count,
        COUNT(DISTINCT DATE(timestamp)) as days_tracked
      FROM activities 
      WHERE org_id = ?
      AND timestamp > datetime('now', '-14 days')
    `,
      [orgId],
    );

    let answer = '**No Automation Patterns Detected Yet** 🤖\n\n';

    if (dataCheck.employee_count < 2) {
      answer +=
        '**Why:** I only see data from 1 employee. Automation patterns emerge when comparing workflows across multiple team members.\n\n';
      answer += '**Next Steps:**\n';
      answer += '• Add more employees to the tracker\n';
      answer +=
        '• Ensure all team members have the desktop tracker running\n';
    } else if (dataCheck.days_tracked < 3) {
      answer += `**Why:** Only ${dataCheck.days_tracked} days of data tracked. I need at least 3-5 days to identify repetitive workflows.\n\n`;
      answer += '**Next Steps:**\n';
      answer += '• Keep the tracker running for a few more days\n';
      answer += '• Check back after a full work week\n';
    } else {
      answer +=
        "**Why:** Your team's workflows are either highly varied (good!) or the tracker needs more diverse activity data.\n\n";
      answer += '**Next Steps:**\n';
      answer += '• Continue tracking — patterns may emerge over time\n';
      answer +=
        '• Focus on standardizing repetitive processes first\n';
    }

    answer += '\n**What I Look For:**\n';
    answer += '• Same sequence of apps used multiple times per day\n';
    answer += '• Manual data entry across multiple systems\n';
    answer += '• Copy-paste workflows between apps\n';
    answer += '• Repetitive file management tasks';

    return {
      answer,
      suggestions: [
        'Show productivity summary',
        'What apps are used most?',
        'Employee time breakdown',
      ],
    };
  }

  const topPatterns = validPatterns.slice(0, 5);

  let answer = `**${validPatterns.length} Automation Opportunities Found**\n\n`;

  topPatterns.forEach((pattern, idx) => {
    const emoji =
      pattern.automationPotential === 'high'
        ? '🔥'
        : pattern.automationPotential === 'medium'
          ? '⚡'
          : '💡';
    answer += `${idx + 1}. ${emoji} **${pattern.description}**\n`;
    answer += `   • Time cost: **${pattern.totalTimeHours} hours/week**\n`;
    answer += `   • Frequency: ${pattern.frequency}x per day\n`;
    answer += `   • Potential: ${pattern.automationPotential.toUpperCase()}\n`;
    answer += `   • 💡 ${pattern.suggestedSolution}\n\n`;
  });

  const totalHours = topPatterns.reduce(
    (sum, p) => sum + p.totalTimeHours,
    0,
  );
  answer += `**💰 Total potential savings: ${Math.round(totalHours * 4)} hours/month**`;

  return {
    answer,
    data: topPatterns,
    suggestions: [
      'Show all patterns',
      'Which tasks are easiest to automate?',
      'Employee-specific opportunities',
    ],
  };
}
