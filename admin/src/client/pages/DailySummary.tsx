import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { formatDurationSeconds } from '../../../shared-types';
import { useI18n } from '../contexts/I18nContext';
import { HelpTip } from '../components/HelpTip';
import { StatusLine } from '../components/Icon';
import { AlertTriangle } from 'lucide-react';

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
      if (!res?.success) throw new Error(res?.error || 'Send failed');
      if (res.sent) {
        setSendResult({ message: `Sent to ${res.recipient}`, variant: 'success' });
      } else {
        setSendResult({ message: `Not sent: ${res.reason || 'unknown reason'}`, variant: 'error' });
      }
    } catch (e) {
      setSendResult({ message: e instanceof Error ? e.message : String(e), variant: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <h1 style={{ ...styles.title, display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('summary.title')}
            <HelpTip text={t('help.summary')} />
          </h1>
          <p style={styles.subtitle}>{t('summary.subtitle')}</p>
        </div>
      </header>

      <div style={styles.controls}>
        <label style={{ fontSize: '13px', color: 'var(--tt-text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {t('common.date')}:
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={styles.dateInput}
          />
        </label>
        <button onClick={load} disabled={loading} style={styles.btnPrimary}>
          {loading ? t('common.loading') : t('common.refresh')}
        </button>
        <button onClick={handleSendNow} disabled={sending} style={styles.btnGhost}>
          {sending ? t('summary.sending') : t('summary.emailNow')}
        </button>
        {sendResult && (
          <StatusLine
            variant={sendResult.variant}
            style={{
              fontSize: '12px',
              color: sendResult.variant === 'success' ? 'var(--tt-success)' : 'var(--tt-amber)',
            }}
          >
            {sendResult.message}
          </StatusLine>
        )}
      </div>

      {error && (
        <div style={styles.errorBanner}>
          <StatusLine variant="error">{error}</StatusLine>
        </div>
      )}

      {summary && (
        <>
          <div style={styles.headerStats}>
            <Stat label="Team Productivity" value={`${summary.teamProductivityScore}%`} color={scoreColor(summary.teamProductivityScore)} />
            <Stat label="Total Tracked" value={formatDurationSeconds(summary.teamTotalSeconds)} color="var(--tt-text)" />
            <Stat label="Productive Time" value={formatDurationSeconds(summary.teamProductiveSeconds)} color="var(--tt-success)" />
            <Stat label="Employees" value={`${summary.employees.length}`} color="var(--tt-teal)" />
          </div>

          <div style={styles.tableWrap}>
            <div style={styles.tableHeader}>
              <div style={{ flex: 2 }}>Employee</div>
              <div style={{ width: '90px', textAlign: 'right' }}>Score</div>
              <div style={{ width: '110px', textAlign: 'right' }}>Total</div>
              <div style={{ width: '110px', textAlign: 'right' }}>Productive</div>
              <div style={{ width: '90px', textAlign: 'right' }}>Idle</div>
              <div style={{ flex: 3 }}>Top Apps</div>
            </div>
            {summary.employees.length === 0 && (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--tt-text-muted)' }}>
                No employees yet. Add one from the Employees page.
              </div>
            )}
            {summary.employees.map(e => (
              <div key={e.employeeId} style={styles.tableRow}>
                <div style={{ flex: 2 }}>
                  <div style={{ fontWeight: 600, color: 'var(--tt-text)' }}>
                    {e.employeeName}
                    {e.suspiciousCount > 0 && (
                      <span style={{ ...styles.suspiciousBadge, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={12} strokeWidth={2} aria-hidden />
                        {e.suspiciousCount}
                      </span>
                    )}
                  </div>
                  {e.outsideHoursSeconds > 0 && (
                    <div style={{ fontSize: '11px', color: 'var(--tt-amber)' }}>
                      {formatDurationSeconds(e.outsideHoursSeconds)} outside business hours (excluded)
                    </div>
                  )}
                </div>
                <div style={{ width: '90px', textAlign: 'right' }}>
                  <span style={{ fontWeight: 700, fontSize: '20px', color: scoreColor(e.productivityScore) }}>
                    {e.productivityScore}%
                  </span>
                </div>
                <div style={{ width: '110px', textAlign: 'right', color: 'var(--tt-text)' }}>
                  {formatDurationSeconds(e.totalSeconds)}
                </div>
                <div style={{ width: '110px', textAlign: 'right', color: 'var(--tt-success)' }}>
                  {formatDurationSeconds(e.productiveSeconds)}
                </div>
                <div style={{ width: '90px', textAlign: 'right', color: 'var(--tt-text-faint)' }}>
                  {formatDurationSeconds(e.idleSeconds)}
                </div>
                <div style={{ flex: 3, fontSize: '12px', color: 'var(--tt-text-muted)' }}>
                  {e.topApps.length === 0
                    ? <span style={{ color: 'var(--tt-text-faint)' }}>No tracked apps</span>
                    : e.topApps.map(a => (
                        <div key={a.app}>
                          <strong>{a.app}</strong>{' '}
                          <span style={{ color: 'var(--tt-text-muted)' }}>
                            ({a.categoryName} · {formatDurationSeconds(a.seconds)})
                          </span>
                        </div>
                      ))
                  }
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: '11px', color: 'var(--tt-text-faint)', marginTop: '12px', textAlign: 'center' as const }}>
            Generated for {summary.orgName} on {summary.date} ({summary.timezone}). Score formula: productive ÷ (productive + unproductive).
          </div>
        </>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div style={styles.statCard}>
    <div style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--tt-text-faint)', letterSpacing: '0.5px' }}>{label}</div>
    <div style={{ fontSize: '28px', fontWeight: 700, color, marginTop: '4px' }}>{value}</div>
  </div>
);

const styles: { [key: string]: React.CSSProperties } = {
  container: { padding: '32px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', gap: '16px' },
  title: { fontSize: '28px', fontWeight: 600, color: 'var(--tt-text)', margin: 0 },
  subtitle: { fontSize: '14px', color: 'var(--tt-text-muted)', margin: '4px 0 0 0' },
  controls: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' as const },
  dateInput: { padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' },
  btnPrimary: { padding: '9px 18px', backgroundColor: 'var(--tt-teal)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
  btnGhost: { padding: '9px 18px', backgroundColor: 'var(--tt-surface-muted)', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' },
  errorBanner: { backgroundColor: 'var(--tt-danger-soft)', border: '1px solid rgba(232, 93, 76, 0.25)', color: 'var(--tt-danger)', padding: '10px 12px', borderRadius: '6px', marginBottom: '12px' },
  headerStats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' },
  statCard: { backgroundColor: 'var(--tt-surface)', padding: '18px', borderRadius: 'var(--tt-radius)', boxShadow: 'var(--tt-shadow-sm)' },
  tableWrap: { backgroundColor: 'var(--tt-surface)', borderRadius: 'var(--tt-radius)', boxShadow: 'var(--tt-shadow-sm)', overflow: 'hidden' },
  tableHeader: { display: 'flex', alignItems: 'center', padding: '12px 16px', gap: '12px', backgroundColor: '#fafbfc', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: 'var(--tt-text-muted)', borderBottom: '1px solid #eef' },
  tableRow: { display: 'flex', alignItems: 'flex-start', padding: '14px 16px', gap: '12px', borderBottom: '1px solid #f1f3f5', fontSize: '13px' },
  suspiciousBadge: { display: 'inline-block', marginLeft: '8px', padding: '2px 8px', borderRadius: '10px', backgroundColor: 'rgba(232, 93, 76, 0.25)', color: 'var(--tt-danger)', fontSize: '10px', fontWeight: 600 }
};
