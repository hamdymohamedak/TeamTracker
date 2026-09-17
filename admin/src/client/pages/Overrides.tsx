import React, { useEffect, useState } from 'react';
import { SlidersHorizontal, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type { Employee } from '../../../shared-types';
import { useI18n } from '../contexts/I18nContext';
import { PageEmpty, PageHero, PagePanel } from '../components/PageHero';

// Per-org / per-employee classification overrides admin page.
//
// The 2026-04-07 audit caught the need: "Overflow Plumbing" is the user's
// uncle's actual business name, and the user has been editing the Wix site
// all evening. The server-side fixer caught the Wix admin pages generically,
// but couldn't classify the bare "Home | Overflow Plumbing & Drain" page
// because it doesn't match any global SaaS pattern. A per-org override
// ("anything containing 'Overflow Plumbing' = core_work, score 95") solves
// this without bloating the global classifier list.
//
// Backend: GET/POST/DELETE /api/overrides — see admin/server/routes.ts.

interface Override {
  id: string;
  org_id: string;
  employee_id: string | null;
  role_type: string | null;
  app_pattern: string;
  category: string;
  productivity_score: number;
  created_at: string;
}

const CATEGORY_OPTIONS: Array<{ value: string; label: string; defaultScore: number }> = [
  { value: 'core_work', label: 'Core Work', defaultScore: 95 },
  { value: 'communication', label: 'Communication', defaultScore: 70 },
  { value: 'research_learning', label: 'Research & Learning', defaultScore: 80 },
  { value: 'planning_docs', label: 'Planning & Docs', defaultScore: 85 },
  { value: 'break_idle', label: 'Break / Idle', defaultScore: 0 },
  { value: 'entertainment', label: 'Entertainment', defaultScore: 5 },
  { value: 'social_media', label: 'Social Media', defaultScore: 10 },
  { value: 'shopping_personal', label: 'Shopping / Personal', defaultScore: 15 },
  { value: 'other', label: 'Other', defaultScore: 30 },
];

export const Overrides: React.FC = () => {
  const { t } = useI18n();
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // Form state
  const [pattern, setPattern] = useState('');
  const [employeeId, setEmployeeId] = useState<string>('__org__');
  const [category, setCategory] = useState('core_work');
  const [score, setScore] = useState(95);

  const load = async () => {
    try {
      setError(null);
      const [overridesRes, empRes] = await Promise.all([
        api.get('/api/overrides'),
        api.get('/api/employees'),
      ]);
      if (overridesRes.success) setOverrides(overridesRes.data || []);
      if (empRes.success) setEmployees(empRes.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overrides');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCategoryChange = (cat: string) => {
    setCategory(cat);
    const opt = CATEGORY_OPTIONS.find(o => o.value === cat);
    if (opt) setScore(opt.defaultScore);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post('/api/overrides', {
        appPattern: pattern.trim(),
        employeeId: employeeId === '__org__' ? null : employeeId,
        category,
        productivityScore: score,
      });
      if (res.success) {
        setPattern('');
        setEmployeeId('__org__');
        setCategory('core_work');
        setScore(95);
        setFlash(`Override added — new activities matching "${pattern.trim()}" will be classified as ${CATEGORY_OPTIONS.find(c => c.value === category)?.label}.`);
        setTimeout(() => setFlash(null), 6000);
        load();
      } else {
        setError(res.error || 'Failed to create override');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create override');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this override? Activities matching the pattern will go back to the default classifier.')) return;
    try {
      await api.delete(`/api/overrides/${id}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete override');
    }
  };

  const getEmployeeName = (id: string | null) => {
    if (!id) return t('overrides.allEmployees');
    return employees.find(e => e.id === id)?.name || `Unknown (${id.slice(0, 8)})`;
  };

  const getCategoryLabel = (value: string) =>
    CATEGORY_OPTIONS.find(o => o.value === value)?.label || value;

  if (loading) {
    return (
      <div className="tt-page">
        <p className="tt-muted">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="tt-page">
      <PageHero
        icon={SlidersHorizontal}
        title={t('overrides.title')}
        subtitle={t('overrides.subtitle')}
        help={t('help.overrides')}
      />

      {flash && <div className="tt-flash">{flash}</div>}
      {error && <div className="tt-error-banner">{error}</div>}

      <PagePanel title={t('overrides.addTitle')} hint={t('overrides.addHint')}>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="tt-field">
            <label className="tt-field-label" htmlFor="override-pattern">
              {t('overrides.pattern')}
            </label>
            <input
              id="override-pattern"
              type="text"
              className="tt-input"
              value={pattern}
              onChange={e => setPattern(e.target.value)}
              placeholder='e.g. "Overflow Plumbing" or "AutoCAD"'
              required
            />
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="tt-field" style={{ flex: 1, minWidth: 200 }}>
              <label className="tt-field-label" htmlFor="override-scope">
                {t('overrides.scope')}
              </label>
              <select
                id="override-scope"
                className="tt-input"
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
              >
                <option value="__org__">{t('overrides.allEmployees')}</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>
            <div className="tt-field" style={{ flex: 1, minWidth: 200 }}>
              <label className="tt-field-label" htmlFor="override-category">
                {t('overrides.category')}
              </label>
              <select
                id="override-category"
                className="tt-input"
                value={category}
                onChange={e => handleCategoryChange(e.target.value)}
              >
                {CATEGORY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="tt-field" style={{ width: 120, minWidth: 120 }}>
              <label className="tt-field-label" htmlFor="override-score">
                {t('overrides.score')}
              </label>
              <input
                id="override-score"
                type="number"
                className="tt-input"
                min={0}
                max={100}
                value={score}
                onChange={e => setScore(Number(e.target.value))}
              />
            </div>
          </div>
          <div>
            <button
              type="submit"
              className="tt-btn tt-btn-primary"
              disabled={submitting || !pattern.trim()}
            >
              {submitting ? t('overrides.adding') : t('overrides.add')}
            </button>
          </div>
        </form>
      </PagePanel>

      <PagePanel title={t('overrides.activeTitle', { count: overrides.length })}>
        {overrides.length === 0 ? (
          <PageEmpty
            icon={SlidersHorizontal}
            title={t('overrides.empty')}
            hint={t('overrides.emptyHint')}
          />
        ) : (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table className="tt-data-table" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>{t('overrides.pattern')}</th>
                  <th>{t('overrides.scope')}</th>
                  <th>{t('overrides.category')}</th>
                  <th>{t('overrides.score')}</th>
                  <th>{t('common.date')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {overrides.map(o => (
                  <tr key={o.id}>
                    <td>
                      <code style={{
                        backgroundColor: 'var(--tt-surface-muted)',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                        fontSize: 12,
                      }}
                      >
                        {o.app_pattern}
                      </code>
                    </td>
                    <td>{getEmployeeName(o.employee_id)}</td>
                    <td>{getCategoryLabel(o.category)}</td>
                    <td>{o.productivity_score}</td>
                    <td>{new Date(o.created_at).toLocaleDateString()}</td>
                    <td>
                      <button
                        type="button"
                        className="tt-action-btn tt-action-btn-danger"
                        onClick={() => remove(o.id)}
                      >
                        <Trash2 size={14} strokeWidth={2.2} />
                        {t('overrides.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="tt-muted" style={{ marginTop: 16, fontSize: 12 }}>
          {t('overrides.note')}
        </p>
      </PagePanel>
    </div>
  );
};
