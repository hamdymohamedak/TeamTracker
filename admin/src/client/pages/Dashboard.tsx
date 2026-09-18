/**
 * Dashboard page — thin composer.
 *
 * Logic is split across:
 *   features/dashboard/hooks/useDashboardStats  — stats + employee polling
 *   features/dashboard/components/*             — GettingStarted, StatCard, BreakdownItem, DashboardSkeleton
 *   features/live-view/components/LiveViewPanel — full live-view UI & state
 *   features/dashboard/dashboard.styles.ts      — shared style tokens
 */
import React, { useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Focus,
  LayoutDashboard,
  Moon,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { PageEmpty, PageHero, PagePanel } from '../components/PageHero';
import { HelpTip } from '../components/HelpTip';
import { formatDurationSeconds } from '../../../shared-types';

import { useDashboardStats } from '../features/dashboard/hooks/useDashboardStats';
import { GettingStarted } from '../features/dashboard/components/GettingStarted';
import { StatCard, BreakdownItem } from '../features/dashboard/components/DashboardStats';
import { DashboardSkeleton } from '../features/dashboard/components/DashboardSkeleton';
import { LiveViewPanel } from '../features/live-view/components/LiveViewPanel';
import { dashboardStyles as styles } from '../features/dashboard/dashboard.styles';

import type { DashboardScope } from '../features/dashboard/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getProductivityColor(score: number): string {
  if (score >= 80) return 'var(--tt-success)';
  if (score >= 60) return 'var(--tt-amber)';
  if (score >= 40) return 'var(--tt-amber)';
  return 'var(--tt-danger)';
}

// ── Page component ────────────────────────────────────────────────────────────

export const Dashboard: React.FC = () => {
  const { org } = useAuth();
  const { t } = useI18n();

  // Persist scope across reloads so the admin doesn't have to re-pick every time.
  const [scope, setScope] = useState<DashboardScope>(() => {
    const saved = localStorage.getItem('teamtracker_dashboard_scope');
    return saved === 'week' || saved === 'all' ? saved : 'today';
  });

  const changeScope = (next: DashboardScope) => {
    setScope(next);
    localStorage.setItem('teamtracker_dashboard_scope', next);
  };

  const { stats, employees, loading, error, reload } = useDashboardStats(scope);

  // ── Loading / error / empty states ───────────────────────────────────────

  if (loading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="tt-page tt-page--wide">
        <PageEmpty
          icon={AlertTriangle}
          title={t('dashboard.failedLoad')}
          hint={error}
          action={
            <button type="button" className="tt-btn tt-btn-primary" onClick={() => void reload()}>
              {t('common.retry')}
            </button>
          }
        />
      </div>
    );
  }

  // Only block the dashboard when the org has no employees yet.
  if (employees.length === 0) {
    return (
      <div className="tt-page tt-page--wide">
        <GettingStarted orgName={org?.name || ''} onDismiss={() => {}} showDismiss={false} />
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="tt-page tt-page--wide" style={{ animation: 'tt-rise 0.45s var(--tt-ease) both' }}>
      <PageHero
        icon={LayoutDashboard}
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        help={t('help.dashboard')}
        action={
          <div role="tablist" aria-label="Dashboard scope" style={styles.scopeTabs as React.CSSProperties}>
            {(['today', 'week', 'all'] as DashboardScope[]).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={scope === s}
                onClick={() => changeScope(s)}
                style={{
                  ...(styles.scopeTab as React.CSSProperties),
                  ...(scope === s ? (styles.scopeTabActive as React.CSSProperties) : null),
                }}
              >
                {s === 'all' ? t('dashboard.all') : s === 'week' ? t('dashboard.week') : t('dashboard.today')}
              </button>
            ))}
          </div>
        }
      />

      {stats && stats.suspiciousActivityCount > 0 && (
        <div className="tt-error-banner" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} aria-hidden />
          {t('dashboard.suspiciousBanner', { count: stats.suspiciousActivityCount })}
        </div>
      )}

      <div style={styles.grid as React.CSSProperties}>
        {/* ── Stat cards ─────────────────────────────────────────────────── */}
        <div style={styles.statTray as React.CSSProperties}>
          <div className="tt-stat-grid">
            <StatCard
              title={t('dashboard.teamProductivity')}
              value={`${stats?.averageProductivityScore || 0}%`}
              icon={<BarChart3 size={20} strokeWidth={2.1} />}
              color={getProductivityColor(stats?.averageProductivityScore || 0)}
              tooltip={t('help.teamProductivity')}
            />
            {(() => {
              const prod = stats?.productiveSecondsToday ?? 0;
              const total = stats?.totalSecondsToday ?? 0;
              const util = total > 0 ? Math.round((prod / total) * 100) : 0;
              return (
                <StatCard
                  title={t('dashboard.utilization')}
                  value={`${util}%`}
                  icon={<Zap size={20} strokeWidth={2.1} />}
                  color={getProductivityColor(util)}
                  tooltip={t('help.utilization')}
                />
              );
            })()}
            <StatCard
              title={t('dashboard.focusTime')}
              value={formatDurationSeconds(stats?.focusSecondsToday ?? (stats?.focusTimeMinutes || 0) * 60)}
              icon={<Focus size={20} strokeWidth={2.1} />}
              color="var(--tt-success)"
              tooltip={t('help.focusTime')}
            />
            <StatCard
              title={t('dashboard.idleTime')}
              value={formatDurationSeconds(stats?.distractedSecondsToday ?? (stats?.distractedTimeMinutes || 0) * 60)}
              icon={<Moon size={20} strokeWidth={2.1} />}
              color="var(--tt-danger)"
              tooltip={t('help.idleTime')}
            />
            <StatCard
              title={t('dashboard.suspicious')}
              value={stats?.suspiciousActivityCount || 0}
              icon={<ShieldAlert size={20} strokeWidth={2.1} />}
              color={stats?.suspiciousActivityCount ? 'var(--tt-danger)' : 'var(--tt-text-faint)'}
              tooltip={t('help.suspicious')}
            />
          </div>
        </div>

        {/* ── Live Activity ───────────────────────────────────────────────── */}
        <LiveViewPanel
          employees={employees}
          employeeActivity={stats?.employeeActivity ?? []}
        />

        {/* ── Time Breakdown ─────────────────────────────────────────────── */}
        <PagePanel
          title={`Time Breakdown (${scope === 'all' ? 'All Time' : scope === 'week' ? 'This Week' : 'Today'})`}
          headAction={<HelpTip text={t('help.timeBreakdown')} />}
        >
          <div style={styles.breakdownGrid as React.CSSProperties}>
            <BreakdownItem label="Core Work" minutes={stats?.productivityBreakdown?.coreWork || 0} color="var(--tt-success)" />
            <BreakdownItem label="Communication" minutes={stats?.productivityBreakdown?.communication || 0} color="var(--tt-teal)" />
            <BreakdownItem label="Research & Learning" minutes={stats?.productivityBreakdown?.researchLearning || 0} color="#9b59b6" />
            <BreakdownItem label="Planning & Docs" minutes={stats?.productivityBreakdown?.planningDocs || 0} color="#1abc9c" />
            <BreakdownItem label="Break/Idle" minutes={stats?.productivityBreakdown?.breakIdle || 0} color="var(--tt-text-faint)" />
            <BreakdownItem label="Entertainment" minutes={stats?.productivityBreakdown?.entertainment || 0} color="var(--tt-danger)" />
            <BreakdownItem label="Social Media" minutes={stats?.productivityBreakdown?.socialMedia || 0} color="var(--tt-amber)" />
            <BreakdownItem label="Shopping/Personal" minutes={stats?.productivityBreakdown?.shoppingPersonal || 0} color="var(--tt-amber)" />
            <BreakdownItem label="Other" minutes={stats?.productivityBreakdown?.other || 0} color="var(--tt-text-faint)" />
          </div>
        </PagePanel>

        {/* ── Suspicious Activity Log ─────────────────────────────────────── */}
        {stats?.recentActivities?.some((a) => a.isSuspicious) && (
          <PagePanel
            title="Suspicious Activity Log"
            headAction={<HelpTip text={t('help.suspiciousLog')} />}
            className="dashboard-suspicious-panel"
          >
            <div style={styles.suspiciousList as React.CSSProperties}>
              {stats.recentActivities
                .filter((a) => a.isSuspicious)
                .slice(0, 10)
                .map((activity) => {
                  const employeeName =
                    activity.employeeName ||
                    employees.find((e) => e.id === activity.employeeId)?.name ||
                    activity.employeeId.slice(0, 8);
                  return (
                    <div key={activity.id} style={styles.suspiciousItem as React.CSSProperties}>
                      <div style={styles.suspiciousHeader as React.CSSProperties}>
                        <span style={styles.suspiciousApp as React.CSSProperties}>
                          {employeeName} · {activity.appName}
                        </span>
                        <span style={styles.suspiciousTime as React.CSSProperties}>
                          {new Date(activity.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div style={styles.suspiciousTitle as React.CSSProperties}>{activity.windowTitle}</div>
                      <div style={styles.suspiciousReasonText as React.CSSProperties}>
                        {activity.suspiciousReason}
                      </div>
                    </div>
                  );
                })}
            </div>
          </PagePanel>
        )}
      </div>
    </div>
  );
};
