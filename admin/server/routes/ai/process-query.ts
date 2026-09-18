import { getDatabase } from '../../database.js';
import type { ChatResponse } from './types.js';
import { handleImprovementQuery } from './handlers/improvement.js';
import { handleStatusQuery } from './handlers/status.js';
import { handleSpecificAppQuery } from './handlers/specific-app.js';
import { handleTimeSpentQuery } from './handlers/time-spent.js';
import { handleProductivityQuery } from './handlers/productivity.js';
import { handleRepetitiveTasksQuery } from './handlers/repetitive.js';
import { handleEmployeeQuery } from './handlers/employee.js';
import { handleAppQuery } from './handlers/app.js';
import { handleGeneralQuery } from './handlers/general.js';
import { handleSlackingQuery } from './handlers/slacking.js';
import { handleOvertimeQuery } from './handlers/overtime.js';
import { handleNonWorkQuery } from './handlers/non-work.js';
import { handleBurnoutQuery } from './handlers/burnout.js';
import { handleCapacityQuery } from './handlers/capacity.js';
import { handleTopPerformerQuery } from './handlers/top-performer.js';

/**
 * Routes a natural-language question to the appropriate handler
 * and returns a ChatResponse with an answer + optional SQL/data.
 */
export async function processNaturalLanguageQuery(
  question: string,
  orgId: string,
): Promise<ChatResponse> {
  const lowerQuestion = question.toLowerCase();
  const db = getDatabase();

  // Pattern 0: Personal improvement/advice queries (highest priority)
  if (
    lowerQuestion.includes('do better') ||
    lowerQuestion.includes('improve') ||
    lowerQuestion.includes('help') ||
    lowerQuestion.includes('advice')
  ) {
    return handleImprovementQuery(lowerQuestion, db, orgId);
  }

  // Pattern 0.5: Architecture firm owner specific queries
  if (
    lowerQuestion.includes('slacking') ||
    lowerQuestion.includes('slacker') ||
    (lowerQuestion.includes('not working') &&
      !lowerQuestion.includes('slack'))
  ) {
    return handleSlackingQuery(lowerQuestion, db, orgId);
  }

  if (
    lowerQuestion.includes('overtime') ||
    lowerQuestion.includes('working late') ||
    lowerQuestion.includes('long hours')
  ) {
    return handleOvertimeQuery(lowerQuestion, db, orgId);
  }

  if (
    lowerQuestion.includes('non-work') ||
    lowerQuestion.includes('wasting time') ||
    lowerQuestion.includes('goofing off') ||
    lowerQuestion.includes('personal time')
  ) {
    return handleNonWorkQuery(lowerQuestion, db, orgId);
  }

  if (
    lowerQuestion.includes('burnout') ||
    lowerQuestion.includes('overworked') ||
    lowerQuestion.includes('stressed')
  ) {
    return handleBurnoutQuery(lowerQuestion, db, orgId);
  }

  if (
    lowerQuestion.includes('capacity') ||
    lowerQuestion.includes('bandwidth') ||
    lowerQuestion.includes('who can take') ||
    lowerQuestion.includes('new project')
  ) {
    return handleCapacityQuery(lowerQuestion, db, orgId);
  }

  if (
    lowerQuestion.includes('best') ||
    lowerQuestion.includes('top performer') ||
    lowerQuestion.includes('star employee') ||
    lowerQuestion.includes('most efficient')
  ) {
    return handleTopPerformerQuery(lowerQuestion, db, orgId);
  }

  // Pattern 1: Specific app queries (YouTube, email, etc.)
  if (
    lowerQuestion.includes('youtube') ||
    lowerQuestion.includes('email') ||
    lowerQuestion.includes('slack') ||
    lowerQuestion.includes('chrome')
  ) {
    return handleSpecificAppQuery(lowerQuestion, db, orgId);
  }

  // Pattern 2: "How is [name] doing" - status check
  if (
    (lowerQuestion.includes('how is') ||
      lowerQuestion.includes("how's")) &&
    lowerQuestion.includes('doing')
  ) {
    return handleStatusQuery(lowerQuestion, db, orgId);
  }

  // Pattern 3: Time spent queries
  if (
    lowerQuestion.includes('time') &&
    (lowerQuestion.includes('spend') || lowerQuestion.includes('spent'))
  ) {
    return handleTimeSpentQuery(lowerQuestion, db, orgId);
  }

  // Pattern 4: Productivity queries
  if (
    lowerQuestion.includes('productive') ||
    lowerQuestion.includes('productivity')
  ) {
    return handleProductivityQuery(lowerQuestion, db, orgId);
  }

  // Pattern 5: Repetitive tasks / automation
  if (
    lowerQuestion.includes('repetitive') ||
    lowerQuestion.includes('automation') ||
    lowerQuestion.includes('automate')
  ) {
    return handleRepetitiveTasksQuery(db, orgId);
  }

  // Pattern 6: Employee-specific queries
  if (
    lowerQuestion.includes('employee') ||
    lowerQuestion.includes('who')
  ) {
    return handleEmployeeQuery(lowerQuestion, db, orgId);
  }

  // Pattern 7: App/website queries
  if (
    lowerQuestion.includes('app') ||
    lowerQuestion.includes('website')
  ) {
    return handleAppQuery(lowerQuestion, db, orgId);
  }

  // Default: General summary
  return handleGeneralQuery(db, orgId);
}
