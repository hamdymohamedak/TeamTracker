/**
 * Shared helpers for AI natural-language query handlers.
 */

/**
 * Looks up an employee by name mention in the question.
 * Sorts longest name first to avoid partial matches.
 */
export async function extractEmployeeName(
  question: string,
  db: any,
  orgId: string,
): Promise<{ id: string; name: string } | null> {
  const employees = await db.all(
    'SELECT id, name FROM employees WHERE org_id = ? AND is_active = 1',
    [orgId],
  );
  const sorted = employees.sort(
    (a: any, b: any) => b.name.length - a.name.length,
  );
  return (
    sorted.find((e: any) =>
      question.toLowerCase().includes(e.name.toLowerCase()),
    ) || null
  );
}

/**
 * Extracts a day-count timeframe from natural-language keywords.
 */
export function extractTimeframe(question: string): {
  days: number;
  label: string;
} {
  const lower = question.toLowerCase();
  if (lower.includes('today')) return { days: 1, label: 'today' };
  if (lower.includes('yesterday')) return { days: 1, label: 'yesterday' };
  if (lower.includes('this week')) return { days: 7, label: 'this week' };
  if (lower.includes('last week')) return { days: 7, label: 'last week' };
  if (lower.includes('this month')) return { days: 30, label: 'this month' };
  if (lower.includes('last month')) return { days: 30, label: 'last month' };
  return { days: 7, label: 'the last 7 days' };
}
