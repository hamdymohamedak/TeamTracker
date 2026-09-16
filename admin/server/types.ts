// Express Request augmentation for auth
declare global {
  namespace Express {
    interface Request {
      orgId?: string;
      userId?: string;
      employeeId?: string;
      tokenType?: 'dashboard' | 'device';
      userRole?: 'owner' | 'admin' | 'viewer';
      /** device_sessions.id when authenticated as a desktop tracker */
      deviceSessionId?: string;
    }
  }
}

export {};
