import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { Employee } from '../../../../../shared-types';
import type { DashboardStats, DashboardScope } from '../types';

function getBrowserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

interface UseDashboardStatsResult {
  stats: DashboardStats | null;
  employees: Employee[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Fetches /api/dashboard/stats and /api/employees on mount and every 30 s.
 * Scope changes restart the polling interval.
 */
export function useDashboardStats(scope: DashboardScope): UseDashboardStatsResult {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const tz = encodeURIComponent(getBrowserTz());
      const [statsData, employeesData] = await Promise.all([
        api.get(`/api/dashboard/stats?tz=${tz}&scope=${scope}`),
        api.get('/api/employees'),
      ]);
      if (statsData.success) setStats(statsData.data);
      if (employeesData.success) {
        const list = employeesData.data || [];
        setEmployees(list);
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void reload();
    const interval = setInterval(() => void reload(), 30_000);
    return () => clearInterval(interval);
  }, [reload]);

  return { stats, employees, loading, error, reload };
}
