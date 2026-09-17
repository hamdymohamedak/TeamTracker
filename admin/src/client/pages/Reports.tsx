import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { Employee, Activity } from '../../../shared-types';
import {
  formatDurationSeconds,
  CATEGORY_DISPLAY_NAMES,
  CATEGORY_COLORS,
  CANONICAL_CATEGORY_ORDER
} from '../../../shared-types';
import { useI18n } from '../contexts/I18nContext';
import { PageHero, PageEmpty, PagePanel } from '../components/PageHero';
import { BarChart3, Clock, Download } from 'lucide-react';

function getBrowserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const SUSPICIOUS_ACTIVITIES_PER_PAGE = 10;

export const Reports: React.FC = () => {
  const { t } = useI18n();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [_activities] = useState<Activity[]>([]);
  const [suspiciousPage, setSuspiciousPage] = useState(1);

  useEffect(() => {
    loadEmployees();
    // Set default date range (last 7 days)
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    setEndDate(end.toISOString().split('T')[0]);
    setStartDate(start.toISOString().split('T')[0]);
  }, []);

  const loadEmployees = async () => {
    try {
      const data = await api.get('/api/employees');
      if (data.success) {
        setEmployees(data.data);
      }
    } catch (error) {
      console.error('Error loading employees:', error);
    }
  };

  const generateReport = async () => {
    if (!selectedEmployee || !startDate || !endDate) return;

    setLoading(true);
    setSuspiciousPage(1); // Reset pagination on new report
    try {
      const tz = encodeURIComponent(getBrowserTz());
      const data = await api.get(
        `/api/reports/productivity?employeeId=${selectedEmployee}&startDate=${startDate}&endDate=${endDate}&tz=${tz}`
      );
      if (data.success) {
        setReport(data.data);
      }
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = async () => {
    if (!selectedEmployee || !startDate || !endDate) return;
    try {
      const tz = encodeURIComponent(getBrowserTz());
      const token = localStorage.getItem('teamtracker_token');
      const res = await fetch(
        `/api/reports/export.csv?employeeId=${selectedEmployee}&startDate=${startDate}&endDate=${endDate}&tz=${tz}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        alert(t('reports.exportFailed', { error: await res.text() }));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `teamtracker-${startDate}-${endDate}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    } catch (e) {
      alert(t('reports.exportFailed', {
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  };

  // Pagination for suspicious activities
  const paginatedSuspiciousActivities = report?.suspiciousActivities?.slice(
    (suspiciousPage - 1) * SUSPICIOUS_ACTIVITIES_PER_PAGE,
    suspiciousPage * SUSPICIOUS_ACTIVITIES_PER_PAGE
  ) || [];
  const totalSuspiciousPages = Math.ceil(
    (report?.suspiciousActivities?.length || 0) / SUSPICIOUS_ACTIVITIES_PER_PAGE
  );

  return (
    <div className="tt-page tt-page--wide">
      <PageHero
        icon={BarChart3}
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        help={t('help.reports')}
      />

      <PagePanel>
        <div className="tt-toolbar">
          <select
            className="tt-input"
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
            style={{ width: 'auto', minWidth: '200px' }}
          >
            <option value="">{t('reports.selectEmployee')}</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>

          <label className="tt-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {t('reports.from')}:
            <input
              type="date"
              className="tt-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ width: 'auto' }}
            />
          </label>

          <label className="tt-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {t('reports.to')}:
            <input
              type="date"
              className="tt-input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ width: 'auto' }}
            />
          </label>

          <button
            type="button"
            className="tt-btn tt-btn-primary"
            onClick={generateReport}
            disabled={!selectedEmployee || loading}
          >
            {loading ? t('reports.generating') : t('reports.generate')}
          </button>

          <button
            type="button"
            className="tt-btn tt-btn-primary"
            onClick={exportCsv}
            disabled={!selectedEmployee || !startDate || !endDate}
            title={t('reports.exportCsvTitle')}
            style={{ background: 'var(--tt-success)' }}
          >
            <Download size={16} strokeWidth={2} aria-hidden />
            {t('reports.exportCsv')}
          </button>
        </div>
      </PagePanel>

      {!report && !loading && (
        <PageEmpty
          icon={BarChart3}
          title={t('reports.emptyTitle')}
          hint={t('reports.emptyHint')}
        />
      )}

      {report && (() => {
        const s = report.summary || {};
        // Prefer the new *_Seconds fields, fall back to *_Hours * 3600 for
        // backwards compatibility with older API responses.
        const totalSeconds       = s.totalSeconds        ?? Math.round((s.totalHours || 0) * 3600);
        const productiveSeconds  = s.productiveSeconds   ?? Math.round((s.productiveHours || 0) * 3600);
        const unproductiveSeconds = s.unproductiveSeconds ?? Math.round((s.unproductiveHours || 0) * 3600);
        const neutralSeconds     = s.neutralSeconds      ?? Math.round((s.neutralHours || 0) * 3600);
        const idleSeconds        = s.idleSeconds         ?? Math.round((s.idleHours || 0) * 3600);
        const outsideHoursSeconds = s.outsideHoursSeconds ?? 0;
        const score              = s.averageProductivityScore ?? 0;

        // Canonical category order, but only show categories with > 0 seconds.
        const rawBreakdown: Record<string, number> =
          report.categoryBreakdownSeconds ||
          Object.fromEntries(
            // legacy: minutes keyed by display name or canonical id
            Object.entries(report.categoryBreakdown || {}).map(([k, v]) => [
              k,
              Math.round(((v as number) || 0) * 60)
            ])
          );
        const orderedCategories = CANONICAL_CATEGORY_ORDER
          .filter(id => (rawBreakdown[id] || 0) > 0)
          .concat(
            // include any categories from the server we don't know about
            Object.keys(rawBreakdown).filter(k => !CANONICAL_CATEGORY_ORDER.includes(k) && (rawBreakdown[k] || 0) > 0)
          );

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="tt-stat-grid">
              <div className="tt-stat">
                <div className="tt-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t('reports.totalHours')}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{formatDurationSeconds(totalSeconds)}</div>
                <p className="tt-muted" style={{ fontSize: 11, marginTop: 4 }}>{t('reports.totalHoursHint')}</p>
              </div>
              <div className="tt-stat">
                <div className="tt-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t('reports.productiveHours')}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: 'var(--tt-success)' }}>
                  {formatDurationSeconds(productiveSeconds)}
                </div>
              </div>
              <div className="tt-stat">
                <div className="tt-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t('reports.unproductiveHours')}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: 'var(--tt-danger)' }}>
                  {formatDurationSeconds(unproductiveSeconds)}
                </div>
              </div>
              <div className="tt-stat">
                <div className="tt-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {t('reports.productivityScore')}
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: 'var(--tt-teal)' }}>{score}%</div>
                <p className="tt-muted" style={{ fontSize: 11, marginTop: 4 }}>{t('reports.scoreFormula')}</p>
              </div>
            </div>

            <PagePanel>
              <div className="tt-stat-grid">
                <ReconcileCell label={t('reports.reconcileProductive')} seconds={productiveSeconds} color="var(--tt-success)" />
                <ReconcileCell label={t('reports.reconcileUnproductive')} seconds={unproductiveSeconds} color="var(--tt-danger)" />
                <ReconcileCell label={t('reports.reconcileNeutral')} seconds={neutralSeconds} color="var(--tt-text-faint)" />
                <ReconcileCell label={t('reports.reconcileIdle')} seconds={idleSeconds} color="var(--tt-text-faint)" />
                <ReconcileCell label={t('reports.reconcileTotal')} seconds={totalSeconds} color="var(--tt-text)" bold />
              </div>
            </PagePanel>

            {report.hasBusinessHours && outsideHoursSeconds > 0 && (
              <PagePanel title={t('reports.outsideHours')}>
                <p className="tt-muted" style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <Clock size={18} strokeWidth={2} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>
                    {t('reports.outsideHoursDesc', { duration: formatDurationSeconds(outsideHoursSeconds) })}
                  </span>
                </p>
              </PagePanel>
            )}

            {report.suspiciousActivities.length > 0 && (
              <PagePanel title={t('reports.suspiciousActivities', { count: report.suspiciousActivities.length })}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {paginatedSuspiciousActivities.map((activity: Activity) => (
                    <div
                      key={activity.id}
                      style={{
                        padding: 12,
                        backgroundColor: 'var(--tt-danger-soft)',
                        border: '1px solid rgba(232, 93, 76, 0.25)',
                        borderRadius: 'var(--tt-radius-sm)',
                      }}
                    >
                      <p style={{ fontWeight: 600, margin: '0 0 4px' }}>{activity.appName}</p>
                      <p className="tt-muted" style={{ fontSize: 14, margin: '0 0 4px' }}>{activity.windowTitle}</p>
                      <p style={{ fontSize: 12, color: 'var(--tt-danger)', margin: '0 0 4px' }}>{activity.suspiciousReason}</p>
                      <p style={{ fontSize: 12, color: 'var(--tt-text-faint)', margin: 0 }}>
                        {new Date(activity.timestamp).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
                {totalSuspiciousPages > 1 && (
                  <div className="tt-toolbar" style={{ justifyContent: 'center', marginTop: 16, marginBottom: 0 }}>
                    <button
                      type="button"
                      className="tt-btn tt-btn-primary"
                      onClick={() => setSuspiciousPage(p => Math.max(1, p - 1))}
                      disabled={suspiciousPage === 1}
                    >
                      {t('reports.prev')}
                    </button>
                    <span className="tt-muted">
                      {t('reports.pageOf', { page: suspiciousPage, total: totalSuspiciousPages })}
                    </span>
                    <button
                      type="button"
                      className="tt-btn tt-btn-primary"
                      onClick={() => setSuspiciousPage(p => Math.min(totalSuspiciousPages, p + 1))}
                      disabled={suspiciousPage === totalSuspiciousPages}
                    >
                      {t('reports.next')}
                    </button>
                  </div>
                )}
              </PagePanel>
            )}

            <PagePanel title={t('reports.categoryBreakdown')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {orderedCategories.length === 0 && (
                  <div className="tt-muted" style={{ textAlign: 'center', padding: 12 }}>
                    {t('reports.noCategories')}
                  </div>
                )}
                {orderedCategories.map((id) => {
                  const seconds = rawBreakdown[id] || 0;
                  const pct = totalSeconds > 0 ? Math.round((seconds / totalSeconds) * 100) : 0;
                  const color = CATEGORY_COLORS[id] || 'var(--tt-text-faint)';
                  const label = CATEGORY_DISPLAY_NAMES[id] || id;
                  return (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: 12,
                        backgroundColor: 'var(--tt-surface-muted)',
                        borderRadius: 6,
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                        <span
                          style={{
                            display: 'inline-block',
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            backgroundColor: color,
                          }}
                        />
                        {label}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--tt-teal)' }}>
                        {formatDurationSeconds(seconds)}{' '}
                        <span style={{ color: 'var(--tt-text-faint)', fontWeight: 400, marginLeft: 6 }}>
                          {pct}%
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </PagePanel>
          </div>
        );
      })()}
    </div>
  );
};

const ReconcileCell: React.FC<{ label: string; seconds: number; color: string; bold?: boolean }> = ({
  label,
  seconds,
  color,
  bold,
}) => (
  <div
    className="tt-stat"
    style={{
      borderLeft: `3px solid ${color}`,
      padding: '10px 12px',
    }}
  >
    <div className="tt-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {label}
    </div>
    <div style={{ fontSize: 18, fontWeight: bold ? 700 : 600, marginTop: 2 }}>
      {formatDurationSeconds(seconds)}
    </div>
  </div>
);
