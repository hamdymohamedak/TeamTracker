// Shared types for the Dashboard feature

export interface Activity {
  id: string;
  employeeId: string;
  employeeName?: string | null;
  appName: string;
  windowTitle: string;
  category: string;
  categoryName: string;
  productivityScore: number;
  productivityLevel: string;
  isSuspicious: boolean;
  suspiciousReason?: string;
  isIdle: boolean;
  timestamp: string;
}

export interface EmployeeActivity {
  employeeId: string;
  employeeName: string;
  currentActivity?: string;
  currentCategory?: string;
  lastActivityAt?: string | null;
  productivityScore: number;
  hoursToday: number;
  secondsToday?: number;
  productiveSeconds?: number;
  unproductiveSeconds?: number;
  neutralSeconds?: number;
  idleSeconds?: number;
  topAppName?: string | null;
  topAppSeconds?: number;
  /** Estimate: today's activity matching privacy block patterns (app/title). */
  privacyMatchedSeconds?: number;
  suspiciousActivityCount: number;
  isIdle?: boolean;
  hasBusinessHours?: boolean;
  outsideHoursSeconds?: number;
}

export interface DashboardStats {
  timezone: string;
  scope?: DashboardScope;
  dayStart: string;
  dayEnd: string;
  totalEmployees: number;
  activeProjects: number;
  totalSecondsToday: number;
  focusSecondsToday: number;
  distractedSecondsToday: number;
  productiveSecondsToday: number;
  unproductiveSecondsToday: number;
  neutralSecondsToday: number;
  idleSecondsToday: number;
  totalHoursToday: number;
  productivityBreakdown: {
    coreWork: number;
    communication: number;
    researchLearning: number;
    planningDocs: number;
    breakIdle: number;
    entertainment: number;
    socialMedia: number;
    shoppingPersonal: number;
    other: number;
  };
  averageProductivityScore: number;
  suspiciousActivityCount: number;
  focusTimeMinutes: number;
  distractedTimeMinutes: number;
  recentActivities: Activity[];
  employeeActivity: EmployeeActivity[];
}

export type DashboardScope = 'today' | 'week' | 'all';
