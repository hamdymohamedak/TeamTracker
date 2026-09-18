/**
 * Shared fixtures for admin server tests.
 */
import type { Request, Response } from 'express';

export type OrgUserFixture = {
  orgId: string;
  userId: string;
  empId: string;
  dashboardToken: string;
  deviceToken: string;
  email: string;
};

type CreateOrgUserDeps = {
  getDatabase: () => { run: (sql: string, params?: unknown[]) => Promise<unknown> };
  hashPassword: (pw: string) => Promise<string>;
  createEmployee: (employee: {
    id: string;
    orgId: string;
    name: string;
    email: string;
    role: string;
    createdAt: string;
    updatedAt: string;
  }) => Promise<void>;
  generateDashboardToken: (input: { userId: string; orgId: string; email: string }) => string;
  generateDeviceToken: (input: { employeeId: string; orgId: string }) => string;
};

export async function createOrgUser(label: string, deps: CreateOrgUserDeps): Promise<OrgUserFixture> {
  const db = deps.getDatabase();
  const now = new Date().toISOString();
  const orgId = `org-${label}`;
  const userId = `user-${label}`;
  const empId = `emp-${label}`;
  const email = `${label}@test.com`;

  await db.run(
    `INSERT INTO organizations (id, name, slug, owner_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [orgId, `Org ${label}`, `org-${label}`, email, now, now]
  );
  const passwordHash = await deps.hashPassword('password123');
  await db.run(
    `INSERT INTO users (id, org_id, email, password_hash, name, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'owner', ?, ?)`,
    [userId, orgId, email, passwordHash, `Owner ${label}`, now, now]
  );
  await deps.createEmployee({
    id: empId,
    orgId,
    name: `Employee ${label}`,
    email: `emp-${label}@test.com`,
    role: 'employee',
    createdAt: now,
    updatedAt: now,
  });
  const dashboardToken = deps.generateDashboardToken({ userId, orgId, email });
  const deviceToken = deps.generateDeviceToken({ employeeId: empId, orgId });
  return { orgId, userId, empId, dashboardToken, deviceToken, email };
}

/** Minimal Express req/res stubs for middleware unit tests. */
export function mockReqRes(authHeader?: string): {
  req: Partial<Request> & { headers: Record<string, string> };
  res: Partial<Response> & { statusCode: number; body: unknown };
} {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  const res: Partial<Response> & { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: null,
    status(c: number) {
      this.statusCode = c;
      return this as Response;
    },
    json(b: unknown) {
      this.body = b;
      return this as Response;
    },
  };
  return { req: req as any, res };
}
