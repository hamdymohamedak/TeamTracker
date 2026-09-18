import type { Express } from 'express';
import { setupDashboardRoutes } from './routes/dashboard-routes.js';
import { setupEmployeeRoutes } from './routes/employee-routes.js';
import { setupProjectRoutes } from './routes/project-routes.js';
import { setupTaskRoutes } from './routes/task-routes.js';
import { setupTimeEntryRoutes } from './routes/time-entry-routes.js';
import { setupActivityRoutes } from './routes/activity-routes.js';
import { setupReportRoutes } from './routes/report-routes.js';
import { setupRoleOverrideRoutes } from './routes/role-override-routes.js';
import { setupPrivacyRoutes } from './routes/privacy-routes.js';

/**
 * Mounts core domain routes. Auth, org, AI, and screenshot/summary routes
 * are registered separately from index.ts.
 */
export function setupRoutes(app: Express): void {
  setupDashboardRoutes(app);
  setupEmployeeRoutes(app);
  setupProjectRoutes(app);
  setupTaskRoutes(app);
  setupTimeEntryRoutes(app);
  setupActivityRoutes(app);
  setupReportRoutes(app);
  setupRoleOverrideRoutes(app);
  setupPrivacyRoutes(app);
}
