import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { formatDurationSeconds } from '../../../shared-types';
import { useI18n } from '../contexts/I18nContext';
import { PageHero, PagePanel } from '../components/PageHero';
import { StatusLine } from '../components/Icon';
import { AlertTriangle, CalendarDays } from 'lucide-react';

// Browser-tz-aware "today" so the date picker defaults match what the user
// sees on the Dashboard. The summary itself is computed in the org's
// timezone server-side; this is just a sensible default for the picker.
function todayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

interface EmployeeSummary {
  employeeId: string;
  employeeName: string;
  totalSeconds: number;
  productiveSeconds: number;
  unproductiveSeconds: number;
  neutralSeconds: number;
  idleSeconds: number;
  outsideHoursSeconds: number;
  productivityScore: number;
  topApps: Array<{ app: string; seconds: number; categoryName: string }>;
  suspiciousCount: number;
}

interface OrgSummary {
  orgId: string;
  orgName: string;
  date: string;
  timezone: string;
  generatedAt: string;
  employees: EmployeeSummary[];
  teamProductivityScore: number;
  teamTotalSeconds: number;
  teamProductiveSeconds: number;
}

const scoreColor = (n: number) =>
  n >= 80 ? 'var(--tt-success)' : n >= 60 ? 'var(--tt-amber)' : 'var(--tt-danger)';

export const DailySummary: React.FC = () => {
  const { t } = useI18n();
  const [date, setDate] = useState<string>(todayLocal());
  const [summary, setSummary] = useState<OrgSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/api/reports/daily-summary?date=${date}`);
      if (!res?.success) throw new Error(res?.error || 'Failed to load summary');
      setSummary(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const handleSendNow = async () => {
    setSendResult(null);
    setSending(true);
    try {
      const res = await api.post('/api/reports/daily-summary/send', { date });
      if (!res?.success) throw new Error(res?.error || t('summary.sendFailed'));
      if (res.sent) {
        setSendResult({
          message: t('summary.sentTo', { recipient: res.recipient }),
          variant: 'success',
        });
      } else {
        setSendResult({
          message: t('summary.notSent', { reason: res.reason || 'unknown reason' }),
          variant: 'error',
        });
      }
    } catch (e) {
      setSendResult({
        message: e instanceof Error ? e.message : String(e),
        variant: 'error',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="tt-page">
      <PageHero
        icon={CalendarDays}
        title={t('summary.title')}
        subtitle={t('summary.subtitle')}
        help={t('help.summary')}
      />

      <PagePanel>
        <div className="tt-toolbar">
          <label className="tt-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('common.date')}:
            <input
              type="date"
              className="tt-input"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{ width: 'auto' }}
            />
          </label>
          <button type="button" className="tt-btn tt-btn-primary" onClick={load} disabled={loading}>
            {loading ? t('common.loading') : t('common.refresh')}
          </button>
          <button type="button" className="tt-btn tt-btn-ghost" onClick={handleSendNow} disabled={sending}>
            {sending ? t('summary.sending') : t('summary.emailNow')}
          </button>
          {sendResult && (
            <StatusLine
              variant={sendResult.variant}
              style={{
                fontSize: 12,
                color: sendResult.variant === 'success' ? 'var(--tt-success)' : 'var(--tt-amber)',
              }}
            >
              {sendResult.message}
            </StatusLine>
          )}
        </div>
      </PagePanel>

      {error && (
        <div className="tt-error-banner">
          <StatusLine variant="error">{error}</StatusLine>
        </div>
      )}

      {summary && (
        <>
          <div className="tt-stat-grid" style={{ marginBottom: 16 }}>
            <div className="tt-stat">
              <div className="tt-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('summary.teamProductivity')}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: scoreColor(summary.teamProductivityScore) }}>
                {summary.teamProductivityScore}%
              </div>
            </div>
            <div className="tt-stat">
              <div className="tt-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('summary.totalTracked')}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>
                {formatDurationSeconds(summary.teamTotalSeconds)}
              </div>
            </div>
            <div className="tt-stat">
              <div className="tt-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('summary.productiveTime')}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: 'var(--tt-success)' }}>
                {formatDurationSeconds(summary.teamProductiveSeconds)}
              </div>
            </div>
            <div className="tt-stat">
              <div className="tt-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('summary.employeesCount')}
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: 'var(--tt-teal)' }}>
                {summary.employees.length}
              </div>
            </div>
          </div>

          <PagePanel>
            <div style={{ overflowX: 'auto' }}>
              <table className="tt-data-table">
                <thead>
                  <tr>
                    <th>{t('summary.colEmployee')}</th>
                    <th style={{ textAlign: 'right' }}>{t('summary.colScore')}</th>
                    <th style={{ textAlign: 'right' }}>{t('summary.colTotal')}</th>
                    <th style={{ textAlign: 'right' }}>{t('summary.colProductive')}</th>
                    <th style={{ textAlign: 'right' }}>{t('summary.colIdle')}</th>
                    <th>{t('summary.colTopApps')}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.employees.length === 0 && (
                    <tr>
                      <td colSpan={6} className="tt-muted" style={{ textAlign: 'center', padding: 24 }}>
                        {t('summary.noEmployees')}
                      </td>
                    </tr>
                  )}
                  {summary.employees.map(e => (
                    <tr key={e.employeeId}>
                      <td>
                        <div style={{ fontWeight: 600 }}>
                          {e.employeeName}
                          {e.suspiciousCount > 0 && (
                            <span
                              className="tt-badge"
                              style={{
                                marginInlineStart: 8,
                                backgroundColor: 'rgba(232, 93, 76, 0.25)',
                                color: 'var(--tt-danger)',
                              }}
                            >
                              <AlertTriangle size={12} strokeWidth={2} aria-hidden />
                              {e.suspiciousCount}
                            </span>
                          )}
                        </div>
                        {e.outsideHoursSeconds > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--tt-amber)', marginTop: 4 }}>
                            {t('summary.outsideHours', { duration: formatDurationSeconds(e.outsideHoursSeconds) })}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, fontSize: 20, color: scoreColor(e.productivityScore) }}>
                          {e.productivityScore}%
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatDurationSeconds(e.totalSeconds)}</td>
                      <td style={{ textAlign: 'right', color: 'var(--tt-success)' }}>
                        {formatDurationSeconds(e.productiveSeconds)}
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--tt-text-faint)' }}>
                        {formatDurationSeconds(e.idleSeconds)}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {e.topApps.length === 0 ? (
                          <span className="tt-muted">{t('summary.noTrackedApps')}</span>
                        ) : (
                          e.topApps.map(a => (
                            <div key={a.app}>
                              <strong>{a.app}</strong>{' '}
                              <span className="tt-muted">
                                ({a.categoryName} · {formatDurationSeconds(a.seconds)})
                              </span>
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PagePanel>

          <p className="tt-muted" style={{ fontSize: 11, marginTop: 12, textAlign: 'center' }}>
            {t('summary.footer', {
              org: summary.orgName,
              date: summary.date,
              tz: summary.timezone,
            })}
          </p>
        </>
      )}
    </div>
  );
};
