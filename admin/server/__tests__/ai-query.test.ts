/**
 * Characterization test: processNaturalLanguageQuery returns a meaningful
 * answer for a simple "team summary" question against a real (in-memory) DB.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { ensureTestEnv, cleanupTestEnv } from './helpers/index.js';

const testEnv = ensureTestEnv('tt-ai-query-');

const { initDatabase, getDatabase, createEmployee } = await import('../database.js');
const { hashPassword, generateDashboardToken, generateDeviceToken } = await import('../auth.js');
const { ensureDataDirectories } = await import('../paths.js');
const { processNaturalLanguageQuery } = await import('../routes/ai/process-query.js');

await initDatabase();
ensureDataDirectories();

describe('processNaturalLanguageQuery', () => {
  let orgId: string;

  before(async () => {
    orgId = 'org-ai-test';
    const db = getDatabase();
    const now = new Date().toISOString();

    // Insert org
    await db.run(
      `INSERT INTO organizations (id, name, slug, owner_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orgId, 'AI Test Org', 'ai-test-org', 'ai@test.com', now, now],
    );

    // Insert an employee
    await createEmployee({
      id: 'emp-ai-1',
      orgId,
      name: 'Alice',
      email: 'alice@test.com',
      role: 'employee',
      createdAt: now,
      updatedAt: now,
    });

    // Insert a few activity rows so queries return real data
    for (let i = 0; i < 5; i++) {
      await db.run(
        `INSERT INTO activities
          (id, employee_id, org_id, app_name, window_title, category, category_name,
           productivity_score, productivity_level, duration_seconds, is_idle, is_suspicious,
           timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?))`,
        [
          `act-ai-${i}`,
          'emp-ai-1',
          orgId,
          'VSCode',
          'main.ts — TeamTracker',
          'development',
          'Development',
          80,
          'productive',
          3600,
          0,
          0,
          `-${i} hours`,
          `-${i} hours`,
        ],
      );
    }
  });

  after(() => cleanupTestEnv(testEnv));

  it('returns an answer string for a generic summary question', async () => {
    const result = await processNaturalLanguageQuery(
      'give me a team summary',
      orgId,
    );
    assert.ok(
      typeof result.answer === 'string' && result.answer.length > 0,
      'answer should be a non-empty string',
    );
  });

  it('returns productivity data for a productivity question', async () => {
    const result = await processNaturalLanguageQuery(
      'how productive is the team this week',
      orgId,
    );
    assert.ok(
      typeof result.answer === 'string' && result.answer.length > 0,
      'answer should be a non-empty string',
    );
    assert.ok(
      Array.isArray(result.suggestions),
      'should include suggestions array',
    );
  });

  it('returns employee status for a named-employee question', async () => {
    const result = await processNaturalLanguageQuery(
      'how is Alice doing today',
      orgId,
    );
    assert.ok(
      result.answer.includes('Alice'),
      `answer should mention Alice, got: ${result.answer}`,
    );
  });

  it('returns suggestions array on every response', async () => {
    const questions = [
      'who is slacking',
      'show overtime workers',
      'who spent time on YouTube',
    ];
    for (const q of questions) {
      const result = await processNaturalLanguageQuery(q, orgId);
      assert.ok(
        Array.isArray(result.suggestions),
        `suggestions should be an array for: "${q}"`,
      );
    }
  });
});
