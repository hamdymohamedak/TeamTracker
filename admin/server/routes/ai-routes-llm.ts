import { Router } from 'express';
import { getDatabase } from '../database.js';
import { computeProductivityStats } from '../../shared-types.js';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../rate-limit.js';

const router: import('express').Router = Router();
router.use(requireAuth);
router.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    keyPrefix: 'ai-llm',
    keyFn: (req) => req.orgId || req.ip || 'unknown',
    message: 'AI rate limit exceeded. Please wait a moment.',
  })
);

/**
 * Helper that mirrors the unified productivity formula used by the Dashboard
 * and Reports endpoints. Computes score from activity rows so Genesis matches
 * human-facing pages. Always org-scoped via parameterized org_id.
 */
async function unifiedScoreFor(
  db: any,
  orgId: string,
  employeeId: string | null,
  daysBack: number
): Promise<{ score: number; productiveSec: number; totalSec: number }> {
  const days = Math.max(1, Math.min(90, Math.floor(Number(daysBack) || 7)));
  const params: any[] = [`-${days} days`, orgId];
  let employeeClause = '';
  if (employeeId) {
    employeeClause = 'AND a.employee_id = ?';
    params.push(employeeId);
  }
  const rows = await db.all(
    `SELECT a.category, a.category_name, a.productivity_level, a.is_idle, a.duration_seconds
     FROM activities a
     WHERE a.timestamp > datetime('now', ?)
       AND a.org_id = ?
       ${employeeClause}`,
    params
  );
  const stats = computeProductivityStats(
    rows.map((r: any) => ({
      category: r.category,
      categoryName: r.category_name,
      productivityLevel: r.productivity_level,
      isIdle: r.is_idle,
      durationSeconds: r.duration_seconds
    }))
  );
  return {
    score: stats.productivityScore,
    productiveSec: stats.productiveSeconds,
    totalSec: stats.totalSeconds
  };
}

interface ChatRequest {
  question: string;
  conversationId?: string;
}

interface ChatResponse {
  answer: string;
  sql?: string;
  data?: any[];
  suggestions?: string[];
  conversationId: string;
}

// Conversation memory store (in production, use Redis).
// Keys are always `${orgId}:${convId}` so tenants cannot share history.
const conversations = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();

// DeepSeek API configuration (works from US servers)
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

/**
 * Call DeepSeek LLM API
 */
async function callLLM(messages: Array<{ role: string; content: string }>, temperature = 0.7): Promise<string> {
  if (!DEEPSEEK_API_KEY) {
    return 'LLM not configured. Please set DEEPSEEK_API_KEY environment variable.';
  }

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('LLM API error:', error);
      return 'Sorry, I encountered an error. Please try again.';
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || 'No response from LLM.';
  } catch (error) {
    console.error('LLM call error:', error);
    return 'Sorry, I encountered an error. Please try again.';
  }
}

/**
 * Generate system prompt with current data context (org-scoped, parameterized).
 */
async function generateSystemPrompt(db: any, orgId: string): Promise<string> {
  // Helper: format duration smartly
  const fmt = (totalSeconds: number) => {
    if (!totalSeconds || totalSeconds <= 0) return '0m';
    const mins = Math.round(totalSeconds / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.round(totalSeconds / 360) / 10;
    return `${hrs}h`;
  };

  const teamCounts = await db.get(
    `SELECT
      COUNT(DISTINCT employee_id) as employee_count,
      COUNT(*) as total_activities,
      SUM(duration_seconds) as total_seconds
    FROM activities
    WHERE timestamp > datetime('now', '-7 days') AND org_id = ?`,
    [orgId]
  );
  const team7d = await unifiedScoreFor(db, orgId, null, 7);
  const stats = {
    employee_count: teamCounts?.employee_count || 0,
    total_activities: teamCounts?.total_activities || 0,
    total_seconds: teamCounts?.total_seconds || 0,
    avg_productivity: team7d.score
  };

  const employees = await db.all(
    `SELECT name, department, hourly_rate FROM employees WHERE is_active = 1 AND org_id = ?`,
    [orgId]
  );

  const todayEmpRows = await db.all(
    `SELECT e.id, e.name, COUNT(a.id) as activities, SUM(a.duration_seconds) as total_seconds
    FROM employees e
    LEFT JOIN activities a ON a.employee_id = e.id
      AND a.timestamp > datetime('now', '-1 day')
      AND a.org_id = ?
    WHERE e.is_active = 1 AND e.org_id = ?
    GROUP BY e.id
    ORDER BY activities DESC
    LIMIT 5`,
    [orgId, orgId]
  );
  const recentActivity: any[] = [];
  for (const row of todayEmpRows) {
    const empStats = await unifiedScoreFor(db, orgId, row.id, 1);
    recentActivity.push({
      name: row.name,
      activities: row.activities,
      avg_score: empStats.score,
      total_seconds: row.total_seconds
    });
  }

  const topApps = await db.all(
    `SELECT
      app_name,
      category_name,
      SUM(duration_seconds) as total_seconds,
      COUNT(*) as usage_count,
      SUM(CASE WHEN productivity_level = 'productive' AND is_idle = 0 THEN duration_seconds ELSE 0 END) as productive_seconds,
      SUM(CASE WHEN productivity_level = 'unproductive' AND is_idle = 0 THEN duration_seconds ELSE 0 END) as unproductive_seconds
    FROM activities
    WHERE timestamp > datetime('now', '-7 days') AND org_id = ?
      AND app_name NOT IN ('loginwindow', 'Window Server', 'kernel', 'system', 'Finder', 'Dock')
    GROUP BY app_name
    ORDER BY total_seconds DESC
    LIMIT 10`,
    [orgId]
  );
  for (const a of topApps) {
    const active = (a.productive_seconds || 0) + (a.unproductive_seconds || 0);
    a.avg_score = active > 0 ? Math.round((a.productive_seconds / active) * 100) : 0;
  }

  const categoryBreakdown = await db.all(
    `SELECT
      category_name,
      SUM(duration_seconds) as total_seconds,
      COUNT(*) as activities
    FROM activities
    WHERE timestamp > datetime('now', '-7 days') AND org_id = ?
    GROUP BY category
    ORDER BY total_seconds DESC`,
    [orgId]
  );

  const employeePatterns = await db.all(
    `SELECT
      e.name,
      a.app_name,
      a.category_name,
      COUNT(*) as times_used,
      SUM(a.duration_seconds) as total_seconds,
      SUM(CASE WHEN a.productivity_level = 'productive' AND a.is_idle = 0 THEN a.duration_seconds ELSE 0 END) as productive_seconds,
      SUM(CASE WHEN a.productivity_level = 'unproductive' AND a.is_idle = 0 THEN a.duration_seconds ELSE 0 END) as unproductive_seconds
    FROM activities a
    JOIN employees e ON a.employee_id = e.id AND e.org_id = a.org_id
    WHERE a.timestamp > datetime('now', '-7 days') AND a.org_id = ?
      AND a.app_name NOT IN ('loginwindow', 'Window Server', 'kernel', 'system', 'Finder', 'Dock')
    GROUP BY e.id, a.app_name
    HAVING times_used > 5
    ORDER BY times_used DESC
    LIMIT 15`,
    [orgId]
  );
  for (const p of employeePatterns) {
    const active = (p.productive_seconds || 0) + (p.unproductive_seconds || 0);
    p.avg_productivity = active > 0 ? Math.round((p.productive_seconds / active) * 100) : 0;
  }

  const todayTitles = await db.all(
    `SELECT
      e.name as employee_name,
      a.window_title,
      COUNT(*) as snapshots,
      SUM(a.duration_seconds) as total_seconds
    FROM activities a
    JOIN employees e ON a.employee_id = e.id AND e.org_id = a.org_id
    WHERE a.timestamp > datetime('now', '-1 day') AND a.org_id = ?
      AND a.window_title IS NOT NULL
      AND a.window_title != ''
      AND a.app_name NOT IN ('loginwindow', 'Window Server', 'kernel', 'system', 'Finder', 'Dock')
    GROUP BY e.id, a.window_title
    ORDER BY snapshots DESC
    LIMIT 40`,
    [orgId]
  );

  const todayBoundsRows = await db.all(
    `SELECT
      e.name as employee_name,
      MIN(a.timestamp) as first_ts,
      MAX(a.timestamp) as last_ts
    FROM activities a
    JOIN employees e ON a.employee_id = e.id AND e.org_id = a.org_id
    WHERE a.timestamp > datetime('now', '-1 day') AND a.org_id = ?
    GROUP BY e.id
    HAVING COUNT(a.id) > 0`,
    [orgId]
  );

  const employeeGaps: Array<{ name: string; firstTs: string; lastTs: string; biggestGapSec: number; gapStart?: string; gapEnd?: string }> = [];
  for (const row of todayBoundsRows) {
    const stamps = await db.all(
      `SELECT timestamp FROM activities a
       JOIN employees e ON a.employee_id = e.id AND e.org_id = a.org_id
       WHERE e.name = ? AND a.timestamp > datetime('now', '-1 day') AND a.org_id = ?
       ORDER BY timestamp ASC`,
      [row.employee_name, orgId]
    );
    let biggestGapSec = 0;
    let gapStart: string | undefined;
    let gapEnd: string | undefined;
    for (let i = 1; i < stamps.length; i++) {
      const prev = new Date(stamps[i - 1].timestamp).getTime();
      const next = new Date(stamps[i].timestamp).getTime();
      const gapSec = Math.round((next - prev) / 1000);
      if (gapSec > biggestGapSec) {
        biggestGapSec = gapSec;
        gapStart = stamps[i - 1].timestamp;
        gapEnd = stamps[i].timestamp;
      }
    }
    employeeGaps.push({
      name: row.employee_name,
      firstTs: row.first_ts,
      lastTs: row.last_ts,
      biggestGapSec,
      gapStart,
      gapEnd
    });
  }
  const fmtTime = (iso: string | undefined) => {
    if (!iso) return '?';
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };
  const fmtGap = (sec: number) => {
    if (!sec || sec < 60) return '<1m';
    const m = Math.round(sec / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  return `You are Genesis, an AI analytics assistant for TeamTracker — an employee productivity tracking system.

PRODUCTIVITY FORMULA (HARDCODED — DO NOT RESTATE OR INVENT A DIFFERENT FORMULA):
  productivity_score = productive_seconds ÷ (productive_seconds + unproductive_seconds)
  - Idle time and uncategorized "Other" time are tracked but NOT counted in either side of that ratio.
  - When asked "what's the formula?" or "how is the score calculated?", answer with EXACTLY the formula above. Do not paraphrase, simplify, or substitute "total" for "(productive + unproductive)" — that would give a different (diluted) number than what the Dashboard and Reports show.

IMPORTANT RULES:
- Only reference data shown below. Do NOT make up numbers.
- Times are shown in minutes (m) or hours (h). Use the exact values given.
- If a value seems low (e.g. "25m tracked"), that's real data — don't assume it's a bug.
- Each "activity" is a 10-second snapshot of what app the employee was using.
- Give advice based on ACTUAL data patterns, not generic productivity tips.
- Do NOT recommend random tools unless they're directly relevant to the apps being used.
- The data below includes WINDOW TITLES (browser tab names, document names). When the user asks "how much time on X", search the window titles section for matching strings, not just the app names — most "X work" happens inside Chrome/Safari and the app name will just say "Chrome".
- The data below includes PER-EMPLOYEE FIRST/LAST ACTIVITY TIMES + the BIGGEST TRACKING GAP today. Use these to call out work-day gaps (e.g. "Mohammed first synced at 1:14am, last synced at 9:13pm, but had a 9h45m gap from 9:09am to 6:54pm — likely a sleeping laptop or the tracker not running"). Don't say "I can't see when activities happened" — that information is right below.

CURRENT TEAM (last 7 days):
- Employees tracked: ${stats.employee_count || 0}
- Total tracked time: ${fmt(stats.total_seconds || 0)}
- Average productivity: ${Math.round(stats.avg_productivity || 0)}%
- Activity snapshots: ${stats.total_activities || 0}

TEAM MEMBERS:
${employees.map((e: any) => `- ${e.name} (${e.department || 'No dept'})`).join('\n') || '- No employees yet'}

TODAY'S ACTIVITY:
${recentActivity.map((a: any) => `- ${a.name}: ${a.activities} snapshots, ${Math.round(a.avg_score)}% productivity, ${fmt(a.total_seconds)} tracked`).join('\n') || '- No activity today'}

TOP APPS (last 7 days):
${topApps.map((a: any) => `- ${a.app_name} [${a.category_name}]: ${fmt(a.total_seconds)}, ${Math.round(a.avg_score)}% score, ${a.usage_count} snapshots`).join('\n') || '- No app data'}

TIME BY CATEGORY (last 7 days):
${categoryBreakdown.map((c: any) => `- ${c.category_name}: ${fmt(c.total_seconds)} (${c.activities} snapshots)`).join('\n') || '- No category data'}

APP USAGE PATTERNS:
${employeePatterns.map((p: any) => `- ${p.name} uses ${p.app_name} [${p.category_name}]: ${p.times_used}x, ${fmt(p.total_seconds)}`).join('\n') || '- Not enough data yet'}

TODAY'S TOP WINDOW TITLES (use this to answer "how much time on X today?" — X is usually in the title, not the app name):
${todayTitles.map((t: any) => `- ${t.employee_name}: "${(t.window_title || '').slice(0, 80)}" — ${t.snapshots} snapshots, ${fmt(t.total_seconds)}`).join('\n') || '- No window title data today'}

TODAY'S WORK WINDOW PER EMPLOYEE (first sync / last sync / biggest tracking gap):
${employeeGaps.map(g => `- ${g.name}: first ${fmtTime(g.firstTs)}, last ${fmtTime(g.lastTs)}, biggest gap ${fmtGap(g.biggestGapSec)}${g.gapStart && g.biggestGapSec >= 600 ? ` (from ${fmtTime(g.gapStart)} to ${fmtTime(g.gapEnd)} — likely laptop sleep or tracker offline)` : ''}`).join('\n') || '- No activity today'}

RESPONSE STYLE:
- Be concise and data-driven. Reference specific numbers from the data above.
- When asked "who was most productive", compare actual employees and scores.
- Suggest 2-3 follow-up questions the business owner might want to ask.
- Keep responses to 3-5 paragraphs max.
- Use markdown formatting (bold, lists) for readability.

TONE: Professional, helpful, like a smart analyst presenting findings to a business owner.`;
}

/**
 * Main chat endpoint with LLM. Requires auth so we can scope all of the
 * stats queries to the caller's org.
 */
router.post('/chat', async (req, res) => {
  try {
    const { question, conversationId }: ChatRequest = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const orgId = req.orgId;
    if (!orgId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const db = getDatabase();

    // Reject conversation IDs that claim another org's composite key
    if (conversationId && conversationId.includes(':')) {
      const prefix = conversationId.split(':')[0];
      if (prefix !== orgId) {
        return res.status(403).json({ error: 'Invalid conversation' });
      }
    }

    const convId =
      conversationId && conversationId.startsWith(`${orgId}:`)
        ? conversationId.slice(orgId.length + 1)
        : conversationId || generateConversationId();
    const memoryKey = `${orgId}:${convId}`;

    let history = conversations.get(memoryKey) || [];

    const systemPrompt = await generateSystemPrompt(db, orgId);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-6),
      { role: 'user', content: question }
    ];

    const answer = await callLLM(messages);

    history.push({ role: 'user', content: question });
    history.push({ role: 'assistant', content: answer });
    conversations.set(memoryKey, history);

    const suggestions = await generateSuggestions(question, answer, db, orgId);

    res.json({
      answer,
      suggestions,
      conversationId: convId
    });
  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({
      answer: 'Sorry, I encountered an error processing your question. Please try again.',
      conversationId: generateConversationId()
    });
  }
});

/**
 * Generate contextual suggestions based on conversation (org-scoped).
 */
async function generateSuggestions(question: string, answer: string, db: any, orgId: string): Promise<string[]> {
  const suggestions: string[] = [];

  const employees = await db.all(
    'SELECT name FROM employees WHERE is_active = 1 AND org_id = ?',
    [orgId]
  );
  const mentionedEmployee = employees.find((e: any) =>
    question.toLowerCase().includes(e.name.toLowerCase())
  );

  if (mentionedEmployee) {
    suggestions.push(`What can ${mentionedEmployee.name} improve?`);
    suggestions.push(`Show ${mentionedEmployee.name}'s app usage`);
  } else if (employees.length > 0) {
    const randomEmployee = employees[Math.floor(Math.random() * employees.length)];
    suggestions.push(`How is ${randomEmployee.name} doing?`);
  }

  const analyticalSuggestions = [
    'Compare team productivity this week vs last week',
    'What are the top time-wasting apps?',
    'Show me focus time trends',
    'Who has the best work-life balance?',
    'What times of day is the team most productive?',
    'Show department comparison'
  ];

  const shuffled = analyticalSuggestions.sort(() => 0.5 - Math.random());
  suggestions.push(...shuffled.slice(0, 2));

  return suggestions.slice(0, 3);
}

/**
 * Enhance LLM response with specific actionable steps
 */
function enhanceResponseWithActions(answer: string, question: string): string {
  const lowerQuestion = question.toLowerCase();
  const lowerAnswer = answer.toLowerCase();

  if (lowerQuestion.includes('repetitive') || lowerQuestion.includes('automate')) {
    if (!lowerAnswer.includes('quick wins') && !lowerAnswer.includes('do these today')) {
      return answer + '\n\n**Quick Wins (Do These Today):**\n' +
        '1. **Chrome users**: Install Toby extension (toby.tab) — organize tabs in 5 minutes\n' +
        '2. **Terminal users**: Add `alias deploy="ssh server && ./deploy.sh"` to ~/.bashrc\n' +
        '3. **VS Code users**: Press Cmd+Shift+P → "Snippets: Configure User Snippets" → create templates\n\n' +
        '**This Week:**\n' +
        '- Document your 3 most common commands in a text file\n' +
        '- Set up 1 GitHub Action for automatic deployment\n' +
        '- Use VS Code Remote-SSH to edit server files directly';
    }
  }

  if (lowerQuestion.includes('productive') || lowerQuestion.includes('focus') || lowerQuestion.includes('distraction')) {
    if (!lowerAnswer.includes('immediate actions') && !lowerAnswer.includes('cold turkey')) {
      return answer + '\n\n**Immediate Actions:**\n' +
        '1. **Block distractions**: Use Cold Turkey (Windows) or SelfControl (Mac) during work hours\n' +
        '2. **Time blocking**: Schedule 2-hour "deep work" blocks in calendar, turn off notifications\n' +
        '3. **Environment**: Close Slack/Teams, put phone in another room\n\n' +
        '**Track Progress:**\n' +
        '- Check TeamTracker dashboard daily at 5pm\n' +
        '- Aim for 3+ hours of "core work" daily\n' +
        '- Review weekly: Is productive time increasing?';
    }
  }

  if (lowerQuestion.includes('burnout') || lowerQuestion.includes('overtime') || lowerQuestion.includes('stress')) {
    if (!lowerAnswer.includes('immediate actions')) {
      return answer + '\n\n**Immediate Actions:**\n' +
        '1. **Check hours**: Anyone working >50 hours/week needs workload review\n' +
        '2. **Conversation**: Schedule 1-on-1 with high-hours employees this week\n' +
        '3. **Redistribute**: Move tasks from overloaded employees to those with capacity\n\n' +
        '**Long-term:**\n' +
        '- Set "core hours" policy (e.g., 10am-4pm in office, rest flexible)\n' +
        '- Review project deadlines — are they realistic?\n' +
        '- Consider hiring if team is consistently overloaded';
    }
  }

  if (lowerQuestion.includes('slack') || lowerQuestion.includes('email') || lowerQuestion.includes('meeting') || lowerQuestion.includes('communication')) {
    if (!lowerAnswer.includes('reduce communication overhead')) {
      return answer + '\n\n**Reduce Communication Overhead:**\n' +
        '1. **Async updates**: Replace daily standups with written updates in Slack\n' +
        '2. **Email batching**: Check email 2x daily (11am, 4pm), not constantly\n' +
        '3. **Meeting audit**: Cancel recurring meetings with no agenda\n\n' +
        '**Tools:**\n' +
        '- Slack: Use /remind for follow-ups instead of mental notes\n' +
        '- Email: Create filters to auto-sort newsletters to folder\n' +
        '- Calendar: Block "focus time" so others can\'t book meetings';
    }
  }

  if (!answer.includes('**') && answer.length > 200 && !lowerAnswer.includes('next steps')) {
    return answer + '\n\n**Next Steps:**\n' +
      '1. Check this data again in 1 week to see trends\n' +
      '2. Share insights with the employee (transparency builds trust)\n' +
      '3. Set 1 specific goal based on this data';
  }

  return answer;
}

function generateConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default router as import('express').Router;
