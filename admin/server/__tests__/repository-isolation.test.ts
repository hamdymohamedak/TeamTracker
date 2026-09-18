/**
 * Repository-level org isolation tests.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { ensureTestEnv, cleanupTestEnv, createOrgUser as createOrgUserFixture } from './helpers/index.js';

const testEnv = ensureTestEnv('tt-repo-');

const {
  initDatabase,
  getDatabase,
  createEmployee,
  getEmployeeById,
  getAllEmployees,
  createProject,
  getProjectById,
  getAllProjects,
  createActivity,
  getAllActivities,
  createTimeEntry,
  getAllTimeEntries,
} = await import('../database.js');
const { generateDashboardToken, generateDeviceToken, hashPassword } = await import('../auth.js');
const { ensureDataDirectories } = await import('../paths.js');

await initDatabase();
ensureDataDirectories();

async function createOrgUser(label: string) {
  return createOrgUserFixture(label, {
    getDatabase,
    hashPassword,
    createEmployee,
    generateDashboardToken,
    generateDeviceToken,
  });
}

describe('repository org isolation', () => {
  it('employees list is org-scoped', async () => {
    const a = await createOrgUser('repoEmpA');
    const b = await createOrgUser('repoEmpB');
    const listA = await getAllEmployees(a.orgId);
    const listB = await getAllEmployees(b.orgId);
    assert.ok(listA.some((e) => e.id === a.empId));
    assert.ok(!listA.some((e) => e.id === b.empId));
    assert.ok(listB.some((e) => e.id === b.empId));
    assert.equal(await getEmployeeById(a.orgId, b.empId), null);
  });

  it('projects are org-scoped', async () => {
    const a = await createOrgUser('repoProjA');
    const b = await createOrgUser('repoProjB');
    const now = new Date().toISOString();
    await createProject({
      id: 'proj-a1',
      orgId: a.orgId,
      name: 'Project A',
      description: '',
      clientName: '',
      status: 'active',
      startDate: now,
      createdAt: now,
      updatedAt: now,
    } as any);
    assert.ok(await getProjectById(a.orgId, 'proj-a1'));
    assert.equal(await getProjectById(b.orgId, 'proj-a1'), null);
    const listB = await getAllProjects(b.orgId);
    assert.ok(!listB.some((p) => p.id === 'proj-a1'));
  });

  it('activities and time entries are org-scoped', async () => {
    const a = await createOrgUser('repoActA');
    const b = await createOrgUser('repoActB');
    const now = new Date().toISOString();
    await createActivity(a.orgId, {
      id: 'repo-act-1',
      employeeId: a.empId,
      timestamp: now,
      appName: 'Code',
      windowTitle: 'x',
      category: 'development',
      categoryName: 'Development',
      productivityScore: 80,
      productivityLevel: 'productive',
      isSuspicious: false,
      isIdle: false,
      idleTimeSeconds: 0,
      durationSeconds: 30,
      createdAt: now,
    });
    await createTimeEntry(a.orgId, {
      id: 'te-1',
      employeeId: a.empId,
      startTime: now,
      duration: 60,
      isBillable: true,
      idleTime: 0,
      source: 'desktop',
      createdAt: now,
      updatedAt: now,
    } as any);

    const actsA = await getAllActivities(a.orgId);
    const actsB = await getAllActivities(b.orgId);
    assert.ok(actsA.some((x) => x.id === 'repo-act-1'));
    assert.ok(!actsB.some((x) => x.id === 'repo-act-1'));

    const teA = await getAllTimeEntries(a.orgId);
    const teB = await getAllTimeEntries(b.orgId);
    assert.ok(teA.some((x) => x.id === 'te-1'));
    assert.ok(!teB.some((x) => x.id === 'te-1'));
  });
});

after(() => {
  cleanupTestEnv(testEnv);
});
