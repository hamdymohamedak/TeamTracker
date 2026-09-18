import { v4 as uuidv4 } from 'uuid';
import {
  createActivity,
  getProjectById,
  getDatabase,
} from '../database.js';
import type { Activity } from '../../shared-types.js';
import {
  detectEmployeeRole,
  reclassifyForRole,
  applyOverrides,
  getRoleStatus,
} from '../role-detector.js';
import { fixActivityClassification } from '../server-classifier-fixer.js';

export interface IngestResult {
  syncedCount: number;
  suspiciousCount: number;
  detectedRole: { roleType: string; status: string } | undefined;
}

/**
 * Core activity-ingestion logic. Applies server-side classification fixes,
 * role-based reclassification, admin overrides, project/task validation, and
 * persists each activity. Called by the POST /api/activity route handler after
 * auth-level checks (token type, employee-org membership) have already passed.
 */
export async function ingestActivities(
  orgId: string,
  employeeId: string,
  activities: any[],
): Promise<IngestResult> {
  let suspiciousCount = 0;
  const savedActivities: Activity[] = [];

  // Resolve optional active project/task from employee record (backward compatible)
  let defaultProjectId: string | null = null;
  let defaultTaskId: string | null = null;
  try {
    const empRow = await getDatabase().get(
      `SELECT active_project_id, active_task_id FROM employees WHERE id = ? AND org_id = ?`,
      [employeeId, orgId]
    );
    defaultProjectId = empRow?.active_project_id || null;
    defaultTaskId = empRow?.active_task_id || null;
  } catch { /* columns may not exist on very old DBs mid-migration */ }

  // Get detected role for this employee (for smart reclassification)
  let detectedRole: { roleType: string; status: string } = { roleType: 'unknown', status: 'learning' };
  try {
    const roleStatus = await getRoleStatus(employeeId);
    detectedRole = { roleType: roleStatus.roleType, status: roleStatus.status };
  } catch (e) {
    // Role detection not ready yet — use original classification
  }

  for (const activityData of activities) {
    // Step 1: server-side classifier fixer. Drops macOS system noise
    // entirely and reclassifies bare-name Mac apps + common SaaS
    // browser tabs that the desktop tracker's classifier missed.
    // This catches activities from older trackers that don't have
    // the latest shared/src/classification.ts rules.
    const fixed = fixActivityClassification({
      appName: activityData.appName || '',
      windowTitle: activityData.windowTitle || '',
      category: activityData.category || 'other',
      categoryName: activityData.categoryName || 'Other',
      productivityScore: activityData.productivityScore ?? 30,
      productivityLevel: activityData.productivityLevel || 'neutral'
    });
    if (!fixed) {
      // System process — skip the activity entirely.
      continue;
    }
    let category = fixed.category;
    let categoryName = fixed.categoryName;
    let productivityScore = fixed.productivityScore;
    let productivityLevel: Activity['productivityLevel'] = fixed.productivityLevel;

    // Apply role-based reclassification if role is detected or overridden
    if (detectedRole.roleType !== 'unknown' && detectedRole.status !== 'learning') {
      const reclassified = reclassifyForRole(
        detectedRole.roleType,
        activityData.appName,
        activityData.windowTitle,
        category,
        productivityScore
      );
      category = reclassified.category;
      categoryName = reclassified.categoryName;
      productivityScore = reclassified.productivityScore;
      productivityLevel = reclassified.productivityLevel as Activity['productivityLevel'];
    }

    // Apply admin overrides (highest priority)
    try {
      const overridden = await applyOverrides(
        employeeId,
        detectedRole.roleType,
        activityData.appName,
        activityData.windowTitle,
        category,
        productivityScore,
        orgId
      );
      category = overridden.category;
      categoryName = overridden.categoryName;
      productivityScore = overridden.productivityScore;
      productivityLevel = overridden.productivityLevel as Activity['productivityLevel'];
    } catch (e) {
      // Override table may not exist yet on first run
    }

    // Prefer explicit per-activity project/task; else employee's active assignment
    let projectId = activityData.projectId || defaultProjectId || undefined;
    let taskId = activityData.taskId || defaultTaskId || undefined;
    // Validate project/task belong to org when provided
    if (projectId) {
      const proj = await getProjectById(orgId, projectId);
      if (!proj) projectId = undefined;
    }
    if (taskId) {
      const task = await getDatabase().get(
        `SELECT id FROM tasks WHERE id = ? AND org_id = ?`,
        [taskId, orgId]
      );
      if (!task) taskId = undefined;
    }

    // Authoritative server receipt time for createdAt; keep client timestamp for activity window
    const activity: Activity = {
      id: activityData.id || uuidv4(),
      employeeId,
      timestamp: activityData.timestamp,
      appName: activityData.appName,
      windowTitle: activityData.windowTitle,
      category,
      categoryName,
      productivityScore,
      productivityLevel,
      isSuspicious: activityData.isSuspicious || false,
      suspiciousReason: activityData.suspiciousReason,
      isIdle: activityData.isIdle || false,
      idleTimeSeconds: activityData.idleTimeSeconds || 0,
      durationSeconds: activityData.durationSeconds || 0,
      projectId,
      taskId,
      createdAt: new Date().toISOString()
    };

    await createActivity(orgId, activity);
    savedActivities.push(activity);

    if (activity.isSuspicious) {
      suspiciousCount++;
    }
  }

  // Trigger role detection in background (non-blocking)
  detectEmployeeRole(employeeId).catch(e => {
    console.warn('Role detection failed:', e.message);
  });

  return {
    syncedCount: savedActivities.length,
    suspiciousCount,
    detectedRole: detectedRole.roleType !== 'unknown' ? detectedRole : undefined,
  };
}
