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
  productivityScore: number;
  hoursToday: number;
  suspiciousActivityCount: number;
  isIdle?: boolean;
}

export interface DashboardStats {
  timezone: string;
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
