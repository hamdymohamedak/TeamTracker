import React, { useEffect, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { api } from '../lib/api';
import type { Employee } from '../../../shared-types';
import { useI18n } from '../contexts/I18nContext';
import { HelpTip } from '../components/HelpTip';

// Privacy capture blocks — forbid screenshots and/or live view when the
// foreground app name or window title contains a pattern (e.g. WhatsApp).

interface PrivacyBlock {
  id: string;
  org_id: string;
  employee_id: string | null;
  app_pattern: string;
  block_screenshots: number;
  block_live_view: number;
  created_at: string;
}

export const PrivacyBlocks: React.FC = () => {
  const { t } = useI18n();
  const [blocks, setBlocks] = useState<PrivacyBlock[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const [pattern, setPattern] = useState('');
  const [employeeId, setEmployeeId] = useState<string>('__org__');
  const [blockScreenshots, setBlockScreenshots] = useState(true);
  const [blockLiveView, setBlockLiveView] = useState(true);

  const load = async () => {
    try {
      setError(null);
      const [blocksRes, empRes] = await Promise.all([
        api.get('/api/privacy-blocks'),
        api.get('/api/employees'),
      ]);
      if (blocksRes.success) setBlocks(blocksRes.data || []);
      if (empRes.success) setEmployees(empRes.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('privacy.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim()) return;
    if (!blockScreenshots && !blockLiveView) {
      setError(t('privacy.needOneTarget'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post('/api/privacy-blocks', {
        appPattern: pattern.trim(),
        employeeId: employeeId === '__org__' ? null : employeeId,
        blockScreenshots,
        blockLiveView,
      });
      if (res.success) {
        setPattern('');
        setEmployeeId('__org__');
        setBlockScreenshots(true);
        setBlockLiveView(true);
        setFlash(t('privacy.added', { pattern: pattern.trim() }));
        setTimeout(() => setFlash(null), 6000);
        void load();
      } else {
        setError(res.error || t('privacy.createFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('privacy.createFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm(t('privacy.deleteConfirm'))) return;
    try {
      await api.delete(`/api/privacy-blocks/${id}`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('privacy.deleteFailed'));
    }
  };

  const getEmployeeName = (id: string | null) => {
    if (!id) return t('privacy.scopeAll');
    return employees.find(e => e.id === id)?.name || `Unknown (${id.slice(0, 8)})`;
  };

  const targetsLabel = (b: PrivacyBlock) => {
    const parts: string[] = [];
    if (b.block_screenshots) parts.push(t('privacy.targetScreenshots'));
    if (b.block_live_view) parts.push(t('privacy.targetLive'));
    return parts.join(' · ') || '—';
  };

  if (loading) {
    return <div style={styles.container}><p>{t('privacy.loading')}</p></div>;
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={{ ...styles.title, display: 'flex', alignItems: 'center', gap: 8 }}>
          <EyeOff size={26} strokeWidth={2.1} />
          {t('privacy.title')}
          <HelpTip text={t('help.privacy')} />
        </h1>
        <p style={styles.subtitle}>{t('privacy.subtitle')}</p>
      </header>

      {flash && <div style={styles.flash}>{flash}</div>}
      {error && <div style={styles.errorBanner}>{error}</div>}

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{t('privacy.addTitle')}</h2>
        <form onSubmit={submit} style={styles.form}>
          <div style={styles.row}>
            <label style={styles.label}>
              {t('privacy.pattern')}
              <input
                type="text"
                value={pattern}
                onChange={e => setPattern(e.target.value)}
                placeholder={t('privacy.patternPlaceholder')}
                required
                style={styles.input}
              />
            </label>
          </div>
          <div style={styles.row}>
            <label style={{ ...styles.label, flex: 1 }}>
              {t('privacy.scope')}
              <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} style={styles.input}>
                <option value="__org__">{t('privacy.scopeAll')}</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </label>
            <div style={{ ...styles.label, flex: 1, justifyContent: 'flex-end' }}>
              <span>{t('privacy.appliesTo')}</span>
              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={blockScreenshots}
                  onChange={e => setBlockScreenshots(e.target.checked)}
                />
                {t('privacy.targetScreenshots')}
              </label>
              <label style={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={blockLiveView}
                  onChange={e => setBlockLiveView(e.target.checked)}
                />
                {t('privacy.targetLive')}
              </label>
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !pattern.trim() || (!blockScreenshots && !blockLiveView)}
            style={styles.submitBtn}
          >
            {submitting ? t('privacy.adding') : t('privacy.add')}
          </button>
        </form>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{t('privacy.activeTitle', { count: blocks.length })}</h2>
        {blocks.length === 0 ? (
          <p style={styles.empty}>{t('privacy.empty')}</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{t('privacy.colPattern')}</th>
                <th style={styles.th}>{t('privacy.colScope')}</th>
                <th style={styles.th}>{t('privacy.colTargets')}</th>
                <th style={styles.th}>{t('privacy.colCreated')}</th>
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {blocks.map(b => (
                <tr key={b.id}>
                  <td style={styles.td}><code style={styles.code}>{b.app_pattern}</code></td>
                  <td style={styles.td}>{getEmployeeName(b.employee_id)}</td>
                  <td style={styles.td}>{targetsLabel(b)}</td>
                  <td style={styles.td}>{new Date(b.created_at).toLocaleDateString()}</td>
                  <td style={styles.td}>
                    <button type="button" onClick={() => void remove(b.id)} style={styles.deleteBtn}>
                      {t('common.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={styles.note}>{t('privacy.note')}</p>
      </section>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  container: { padding: 'clamp(16px, 4vw, 32px)' },
  header: { marginBottom: '24px' },
  title: { fontSize: '28px', fontWeight: 600, color: 'var(--tt-text)', margin: 0 },
  subtitle: { fontSize: '14px', color: 'var(--tt-text-muted)', marginTop: '8px', maxWidth: '760px', lineHeight: 1.5 },
  code: { backgroundColor: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '12px' },
  card: { backgroundColor: 'var(--tt-surface)', padding: '24px', borderRadius: 'var(--tt-radius)', boxShadow: 'var(--tt-shadow-sm)', marginBottom: '24px' },
  cardTitle: { fontSize: '18px', fontWeight: 600, color: 'var(--tt-text)', marginTop: 0, marginBottom: '16px' },
  form: { display: 'flex', flexDirection: 'column', gap: '16px' },
  row: { display: 'flex', gap: '16px', flexWrap: 'wrap' },
  label: { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--tt-text)', flex: 1, minWidth: '200px' },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, fontSize: 13 },
  input: { padding: '10px 12px', border: '1px solid #d0d7de', borderRadius: '6px', fontSize: '14px', fontWeight: 400 },
  submitBtn: { alignSelf: 'flex-start', padding: '10px 20px', backgroundColor: 'var(--tt-teal)', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e0e6ed', fontSize: '12px', textTransform: 'uppercase', color: 'var(--tt-text-muted)', fontWeight: 600 },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: '14px', color: 'var(--tt-text)' },
  deleteBtn: { padding: '6px 12px', backgroundColor: 'rgba(232, 93, 76, 0.25)', color: '#dc2626', border: 'none', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' },
  empty: { color: 'var(--tt-text-faint)', fontStyle: 'italic', margin: 0 },
  note: { fontSize: '12px', color: 'var(--tt-text-muted)', marginTop: '16px', marginBottom: 0, lineHeight: 1.5 },
  flash: { backgroundColor: '#d4edda', color: '#155724', padding: '12px 16px', borderRadius: 'var(--tt-radius-sm)', marginBottom: '16px', fontSize: '14px' },
  errorBanner: { backgroundColor: 'var(--tt-danger-soft)', color: 'var(--tt-danger)', padding: '12px 16px', borderRadius: 'var(--tt-radius-sm)', marginBottom: '16px', fontSize: '14px' },
};
