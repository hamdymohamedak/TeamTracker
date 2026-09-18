import React, { useEffect, useMemo, useState } from 'react';
import { EyeOff, Plus, Shield, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Employee } from '../../../../shared-types';
import { useI18n } from '@/contexts/I18nContext';
import { PageEmpty, PageHero, PagePanel } from '@/components/PageHero';

type PrivacyUrlMode = 'blocklist' | 'allowlist';

interface PrivacyBlock {
  id: string;
  org_id: string;
  employee_id: string | null;
  app_pattern: string;
  block_screenshots: number;
  block_live_view: number;
  created_at: string;
}

const FORM_PRESETS: { id: string; pattern: string }[] = [
  { id: 'whatsapp', pattern: 'https://web.whatsapp.com/' },
  { id: 'telegram', pattern: 'https://web.telegram.org/' },
  { id: 'gmail', pattern: 'https://mail.google.com/' },
  { id: 'github', pattern: 'https://github.com/' },
];

function previewHost(pattern: string): string | null {
  const raw = pattern.trim().toLowerCase();
  if (!raw) return null;
  const looksLikeUrl =
    /^https?:\/\//.test(raw) ||
    (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw) && raw.includes('.'));
  if (!looksLikeUrl) return null;
  try {
    const asUrl = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    return new URL(asUrl).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export const PrivacyBlocks: React.FC = () => {
  const { t } = useI18n();
  const [blocks, setBlocks] = useState<PrivacyBlock[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [showToEmployees, setShowToEmployees] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [urlMode, setUrlMode] = useState<PrivacyUrlMode>('blocklist');
  const [savingMode, setSavingMode] = useState(false);

  const [pattern, setPattern] = useState('');
  const [employeeId, setEmployeeId] = useState<string>('__org__');
  const [blockScreenshots, setBlockScreenshots] = useState(true);
  const [blockLiveView, setBlockLiveView] = useState(true);

  const preview = useMemo(() => previewHost(pattern), [pattern]);
  const isAllowlist = urlMode === 'allowlist';

  const load = async () => {
    try {
      setError(null);
      const [blocksRes, empRes, orgRes] = await Promise.all([
        api.get('/api/privacy-blocks'),
        api.get('/api/employees'),
        api.get('/api/organization'),
      ]);
      if (blocksRes.success) setBlocks(blocksRes.data || []);
      if (empRes.success) setEmployees(empRes.data || []);
      if (orgRes.success && orgRes.data) {
        const org = orgRes.data as {
          showPrivacyBlocksToEmployees?: boolean;
          privacyUrlMode?: PrivacyUrlMode;
        };
        setShowToEmployees(!!org.showPrivacyBlocksToEmployees);
        setUrlMode(org.privacyUrlMode === 'allowlist' ? 'allowlist' : 'blocklist');
      }
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

  const saveOrgFlag = async (
    body: Record<string, unknown>,
    onFail: () => void,
    onOkFlash: string
  ) => {
    setError(null);
    try {
      const res = await api.put('/api/organization', body);
      if (!res.success) {
        onFail();
        setError(res.error || t('privacy.visibilitySaveFailed'));
        return false;
      }
      setFlash(onOkFlash);
      setTimeout(() => setFlash(null), 5000);
      return true;
    } catch (err) {
      onFail();
      setError(err instanceof Error ? err.message : t('privacy.visibilitySaveFailed'));
      return false;
    }
  };

  const toggleShowToEmployees = async (next: boolean) => {
    setSavingVisibility(true);
    const prev = showToEmployees;
    setShowToEmployees(next);
    await saveOrgFlag(
      { showPrivacyBlocksToEmployees: next },
      () => setShowToEmployees(prev),
      next ? t('privacy.visibilityOn') : t('privacy.visibilityOff')
    );
    setSavingVisibility(false);
  };

  const changeUrlMode = async (next: PrivacyUrlMode) => {
    if (next === urlMode) return;
    setSavingMode(true);
    const prev = urlMode;
    setUrlMode(next);
    await saveOrgFlag(
      { privacyUrlMode: next },
      () => setUrlMode(prev),
      next === 'allowlist' ? t('privacy.modeAllowlistOn') : t('privacy.modeBlocklistOn')
    );
    setSavingMode(false);
  };

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
        aliases: [],
        employeeId: employeeId === '__org__' ? null : employeeId,
        blockScreenshots,
        blockLiveView,
      });
      if (res.success) {
        const saved = (res.data as { appPattern?: string } | undefined)?.appPattern || pattern.trim();
        setPattern('');
        setEmployeeId('__org__');
        setBlockScreenshots(true);
        setBlockLiveView(true);
        setFlash(t('privacy.added', { pattern: saved }));
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

  if (loading) {
    return <div className="tt-page"><p className="tt-muted">{t('privacy.loading')}</p></div>;
  }

  return (
    <div className="tt-page">
      <PageHero
        icon={EyeOff}
        title={t('privacy.title')}
        subtitle={t('privacy.subtitle')}
        help={t('help.privacy')}
      />

      {flash && <div className="tt-flash">{flash}</div>}
      {error && <div className="tt-error-banner">{error}</div>}

      <PagePanel title={t('privacy.modeTitle')} hint={t('privacy.modeHint')}>
        <div style={styles.segment} role="tablist" aria-label={t('privacy.modeTitle')}>
          <button
            type="button"
            role="tab"
            aria-selected={!isAllowlist}
            disabled={savingMode}
            style={{ ...styles.segmentBtn, ...(!isAllowlist ? styles.segmentBtnActive : null) }}
            onClick={() => void changeUrlMode('blocklist')}
          >
            <Shield size={16} strokeWidth={2.2} />
            {t('privacy.modeBlocklist')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isAllowlist}
            disabled={savingMode}
            style={{ ...styles.segmentBtn, ...(isAllowlist ? styles.segmentBtnActiveAllow : null) }}
            onClick={() => void changeUrlMode('allowlist')}
          >
            <ShieldCheck size={16} strokeWidth={2.2} />
            {t('privacy.modeAllowlist')}
          </button>
        </div>
        <p style={styles.modeExplain}>
          {isAllowlist ? t('privacy.modeAllowlistExplain') : t('privacy.modeBlocklistExplain')}
        </p>
      </PagePanel>

      <section style={styles.panel}>
        <div style={styles.visibilityRow}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={styles.panelTitle}>{t('privacy.visibilityTitle')}</h2>
            <p style={{ ...styles.panelHint, marginBottom: 0 }}>{t('privacy.visibilityHint')}</p>
          </div>
          <label style={styles.toggleWrap}>
            <input
              type="checkbox"
              role="switch"
              checked={showToEmployees}
              disabled={savingVisibility}
              onChange={e => void toggleShowToEmployees(e.target.checked)}
              style={styles.toggleInput}
            />
            <span style={{ ...styles.toggleTrack, ...(showToEmployees ? styles.toggleTrackOn : null) }}>
              <span style={{ ...styles.toggleThumb, ...(showToEmployees ? styles.toggleThumbOn : null) }} />
            </span>
            <span style={styles.toggleText}>
              {showToEmployees ? t('privacy.visibilityEnabled') : t('privacy.visibilityDisabled')}
            </span>
          </label>
        </div>
      </section>

      <section style={styles.panel}>
        <h2 style={styles.panelTitle}>
          {isAllowlist ? t('privacy.addAllowTitle') : t('privacy.addTitle')}
        </h2>
        <div style={styles.presetRow}>
          {FORM_PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              style={styles.chip}
              onClick={() => setPattern(p.pattern)}
            >
              {p.id === 'whatsapp'
                ? t('privacy.preset.whatsapp')
                : p.id === 'telegram'
                  ? t('privacy.preset.telegram')
                  : p.id === 'github'
                    ? t('privacy.preset.github')
                    : t('privacy.preset.gmail')}
            </button>
          ))}
        </div>
        <form onSubmit={submit} style={styles.form}>
          <label style={styles.label}>
            {isAllowlist ? t('privacy.patternAllow') : t('privacy.pattern')}
            <input
              type="text"
              value={pattern}
              onChange={e => setPattern(e.target.value)}
              placeholder={t('privacy.patternPlaceholder')}
              required
              style={styles.input}
            />
            <span style={styles.hint}>
              {isAllowlist ? t('privacy.patternHintAllow') : t('privacy.patternHint')}
            </span>
            {preview && (
              <span style={styles.hint}>{t('privacy.normalizedAs', { host: preview })}</span>
            )}
          </label>
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
            <div style={{ ...styles.label, flex: 1 }}>
              <span>{isAllowlist ? t('privacy.appliesAllow') : t('privacy.appliesTo')}</span>
              <div style={styles.checkGroup}>
                <label style={styles.checkPill}>
                  <input
                    type="checkbox"
                    checked={blockScreenshots}
                    onChange={e => setBlockScreenshots(e.target.checked)}
                  />
                  {t('privacy.targetScreenshots')}
                </label>
                <label style={styles.checkPill}>
                  <input
                    type="checkbox"
                    checked={blockLiveView}
                    onChange={e => setBlockLiveView(e.target.checked)}
                  />
                  {t('privacy.targetLive')}
                </label>
              </div>
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || !pattern.trim() || (!blockScreenshots && !blockLiveView)}
            style={styles.primaryBtn}
          >
            <Plus size={16} strokeWidth={2.4} />
            {submitting ? t('privacy.adding') : (isAllowlist ? t('privacy.addAllow') : t('privacy.add'))}
          </button>
        </form>
      </section>

      <section style={styles.panel}>
        <div style={styles.listHead}>
          <h2 style={styles.panelTitle}>
            {isAllowlist
              ? t('privacy.activeAllowTitle', { count: blocks.length })
              : t('privacy.activeTitle', { count: blocks.length })}
          </h2>
        </div>
        {blocks.length === 0 ? (
          <PageEmpty
            icon={EyeOff}
            title={isAllowlist ? t('privacy.emptyAllow') : t('privacy.empty')}
          />
        ) : (
          <div style={styles.ruleList}>
            {blocks.map(b => {
              const host = previewHost(b.app_pattern);
              return (
                <div key={b.id} style={styles.ruleCard}>
                  <div style={styles.ruleMain}>
                    <code style={styles.code}>{b.app_pattern}</code>
                    <div style={styles.metaRow}>
                      {host && <span style={styles.badge}>{t('privacy.hostLabel')}</span>}
                      <span style={styles.metaText}>{getEmployeeName(b.employee_id)}</span>
                      <span style={styles.metaDot}>·</span>
                      <span style={styles.metaText}>
                        {[
                          b.block_screenshots ? t('privacy.targetScreenshots') : null,
                          b.block_live_view ? t('privacy.targetLive') : null,
                        ].filter(Boolean).join(' · ')}
                      </span>
                      <span style={styles.metaDot}>·</span>
                      <span style={styles.metaText}>{new Date(b.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(b.id)}
                    style={styles.iconDelete}
                    aria-label={t('common.delete')}
                    title={t('common.delete')}
                  >
                    <Trash2 size={15} strokeWidth={2.1} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p style={styles.note}>{isAllowlist ? t('privacy.noteAllow') : t('privacy.note')}</p>
      </section>
    </div>
  );
};

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    padding: 'clamp(20px, 4vw, 36px)',
    maxWidth: 920,
    margin: '0 auto',
  },
  muted: { color: 'var(--tt-text-muted)' },
  hero: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 28,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--tt-surface-muted)',
    border: '1px solid var(--tt-border)',
    color: 'var(--tt-text)',
    flexShrink: 0,
  },
  title: {
    fontSize: 26,
    fontWeight: 650,
    color: 'var(--tt-text)',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--tt-text-muted)',
    marginTop: 8,
    lineHeight: 1.55,
    maxWidth: 640,
  },
  panel: {
    background: 'var(--tt-surface)',
    border: '1px solid var(--tt-border)',
    borderRadius: 'var(--tt-radius-lg)',
    boxShadow: 'var(--tt-shadow-sm)',
    padding: '22px 22px 20px',
    marginBottom: 16,
  },
  panelHead: { marginBottom: 14 },
  panelTitle: {
    fontSize: 15,
    fontWeight: 650,
    color: 'var(--tt-text)',
    margin: 0,
    letterSpacing: '-0.01em',
  },
  panelHint: {
    fontSize: 13,
    color: 'var(--tt-text-muted)',
    margin: '6px 0 0',
    lineHeight: 1.5,
  },
  segment: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    padding: 4,
    borderRadius: 12,
    background: 'var(--tt-surface-muted)',
    border: '1px solid var(--tt-border)',
  },
  segmentBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 10px',
    border: 'none',
    borderRadius: 10,
    background: 'transparent',
    color: 'var(--tt-text-muted)',
    fontSize: 13,
    fontWeight: 650,
    cursor: 'pointer',
  },
  segmentBtnActive: {
    background: 'var(--tt-surface)',
    color: 'var(--tt-text)',
    boxShadow: 'var(--tt-shadow-sm)',
  },
  segmentBtnActiveAllow: {
    background: 'var(--tt-surface)',
    color: 'var(--tt-success)',
    boxShadow: 'var(--tt-shadow-sm)',
  },
  modeExplain: {
    margin: '12px 0 0',
    fontSize: 12,
    color: 'var(--tt-text-muted)',
    lineHeight: 1.5,
  },
  visibilityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  toggleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
    userSelect: 'none',
  },
  toggleInput: { position: 'absolute', opacity: 0, width: 0, height: 0 },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 999,
    background: '#d4d4d4',
    position: 'relative',
    transition: 'background 160ms ease',
    flexShrink: 0,
  },
  toggleTrackOn: { background: 'var(--tt-success)' },
  toggleThumb: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 160ms ease',
  },
  toggleThumbOn: { transform: 'translateX(18px)' },
  toggleText: { fontSize: 13, fontWeight: 600, color: 'var(--tt-text)', maxWidth: 220 },
  form: { display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 },
  row: { display: 'flex', gap: 14, flexWrap: 'wrap' },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--tt-text)',
  },
  hint: { fontSize: 12, fontWeight: 400, color: 'var(--tt-text-muted)', lineHeight: 1.4 },
  input: {
    padding: '11px 12px',
    border: '1px solid var(--tt-border-strong)',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 400,
    background: 'var(--tt-surface)',
    color: 'var(--tt-text)',
  },
  checkGroup: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  checkPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid var(--tt-border-strong)',
    background: 'var(--tt-surface-muted)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  primaryBtn: {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '11px 18px',
    background: 'var(--tt-ink)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 650,
    cursor: 'pointer',
  },
  presetRow: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0 16px' },
  chip: {
    padding: '7px 12px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 999,
    border: '1px solid var(--tt-border-strong)',
    background: 'var(--tt-surface-muted)',
    color: 'var(--tt-text)',
    cursor: 'pointer',
  },
  listHead: { marginBottom: 14 },
  ruleList: { display: 'flex', flexDirection: 'column', gap: 8 },
  ruleCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 14px',
    borderRadius: 12,
    border: '1px solid var(--tt-border)',
    background: 'var(--tt-surface-muted)',
  },
  ruleMain: { minWidth: 0, flex: 1 },
  code: {
    display: 'inline-block',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--tt-text)',
    wordBreak: 'break-all',
  },
  metaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  badge: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--tt-text-muted)',
    background: 'var(--tt-surface)',
    border: '1px solid var(--tt-border)',
    borderRadius: 999,
    padding: '3px 8px',
  },
  metaText: { fontSize: 12, color: 'var(--tt-text-muted)' },
  metaDot: { color: 'var(--tt-text-faint)', fontSize: 12 },
  iconDelete: {
    width: 36,
    height: 36,
    borderRadius: 10,
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--tt-danger)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  },
  emptyBox: {
    padding: '28px 16px',
    borderRadius: 12,
    border: '1px dashed var(--tt-border-strong)',
    textAlign: 'center',
  },
  empty: { color: 'var(--tt-text-faint)', margin: 0, fontSize: 13, lineHeight: 1.5 },
  note: { fontSize: 12, color: 'var(--tt-text-muted)', marginTop: 14, marginBottom: 0, lineHeight: 1.5 },
  flash: {
    background: 'var(--tt-success-soft)',
    color: 'var(--tt-success)',
    padding: '12px 14px',
    borderRadius: 'var(--tt-radius-sm)',
    marginBottom: 14,
    fontSize: 14,
  },
  errorBanner: {
    background: 'var(--tt-danger-soft)',
    color: 'var(--tt-danger)',
    padding: '12px 14px',
    borderRadius: 'var(--tt-radius-sm)',
    marginBottom: 14,
    fontSize: 14,
  },
};
