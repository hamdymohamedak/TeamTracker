/**
 * Shared TypeScript interfaces for the tracker subsystem.
 * No Electron deps — safe to import in tests.
 */
import type { ActivityCategory } from '../classifier.js';

export interface TrackedActivity {
  id: string;
  timestamp: string;
  appName: string;
  windowTitle: string;
  category: ActivityCategory;
  categoryName: string;
  productivityScore: number;
  productivityLevel: 'productive' | 'neutral' | 'unproductive' | 'idle';
  isSuspicious: boolean;
  suspiciousReason?: string;
  isIdle: boolean;
  idleTimeSeconds: number;
  durationSeconds: number;
  hasInputActivity: boolean;
}

export interface Config {
  employeeId: string;
  employeeName: string;
  serverUrl: string;
  deviceToken?: string;
  /** Optional active project for activity payload (set via IPC / updateConfig). */
  activeProjectId?: string;
  /** Optional active task for activity payload (set via IPC / updateConfig). */
  activeTaskId?: string;
}
