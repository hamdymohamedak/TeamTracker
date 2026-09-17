import React, { useState, useEffect, useMemo } from 'react';
import type { Employee } from '../../../shared-types';
import { SUPPORTED_CURRENCIES, formatCurrency, JOB_ROLES } from '../../../shared-types';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { EmptyIcon, ModalCloseButton, StatusLine } from '../components/Icon';
import { PageEmpty, PageHero } from '../components/PageHero';
import {
  AlertTriangle,
  Building2,
  Clock,
  Download,
  Globe,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  Search,
  ShieldOff,
  Trash2,
  Users,
} from 'lucide-react';

// Common IANA timezones offered in the per-employee timezone dropdown.
// Covers North America + Europe + APAC + Middle East — admins can leave it
// empty to inherit the organization's timezone.
const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Istanbul',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland'
];

const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' }
];

interface EmployeeFormData {
  name: string;
  email: string;
  role: string;
  department: string;
  hourlyRate: string;
  currency: string;
  timezone: string;            // '' = inherit org tz
  businessHoursEnabled: boolean;
  businessHoursStart: string;  // "HH:MM"
  businessHoursEnd: string;    // "HH:MM"
  businessHoursDays: number[]; // ISO weekdays: 1..7
  jobRoleType: string;         // 'auto' | 'developer' | ...
}

const emptyFormData = (defaultCurrency: string): EmployeeFormData => ({
  name: '',
  email: '',
  role: 'employee',
  department: '',
  hourlyRate: '',
  currency: defaultCurrency,
  timezone: '',
  businessHoursEnabled: false,
  businessHoursStart: '09:00',
  businessHoursEnd: '17:00',
  businessHoursDays: [1, 2, 3, 4, 5],
  jobRoleType: 'auto'
});

export const Employees: React.FC = () => {
  const { t } = useI18n();
  const { org } = useAuth();
  const defaultCurrency = org?.defaultCurrency || 'USD';
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [setupToken, setSetupToken] = useState<{ token: string; employeeName: string } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<{ employeeName: string } | null>(null);
  const [formData, setFormData] = useState<EmployeeFormData>(emptyFormData(defaultCurrency));
  const [query, setQuery] = useState('');

  useEffect(() => {
    loadEmployees();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e => {
      const hay = [e.name, e.email, e.department, e.role, e.timezone]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [employees, query]);

  const openCreate = () => {
    setEditingEmployee(null);
    setFormData(emptyFormData(defaultCurrency));
    setFormError(null);
    setShowForm(true);
  };

  const initials = (name: string) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };
  const loadEmployees = async () => {
    try {
      setError(null);
      const data = await api.get('/api/employees');
      if (data.success) {
        setEmployees(data.data);
      } else {
        throw new Error(data.error || 'Failed to load employees');
      }
    } catch (err) {
      console.error('Error loading employees:', err);
      setError(err instanceof Error ? err.message : 'Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validation
    if (!formData.name.trim()) {
      setFormError('Name is required');
      return;
    }
    if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setFormError('Please enter a valid email address');
      return;
    }
    if (formData.businessHoursEnabled) {
      // Accept "HH:MM" or "HH:MM:SS" (some browsers emit seconds on type=time).
      const timeRe = /^\d{1,2}:\d{2}(:\d{2})?$/;
      if (!timeRe.test(formData.businessHoursStart) || !timeRe.test(formData.businessHoursEnd)) {
        setFormError('Business hours must be in HH:MM format');
        return;
      }
      if (formData.businessHoursDays.length === 0) {
        setFormError('Pick at least one business day');
        return;
      }
    }

    // Normalize HH:MM:SS → HH:MM so the server always stores a consistent
    // shape that matches the UI's time picker values on reload.
    const normalizeTime = (v: string) => v.replace(/^(\d{1,2}:\d{2}).*$/, '$1').padStart(5, '0');

    const url = editingEmployee
      ? `/api/employees/${editingEmployee.id}`
      : '/api/employees';

    try {
      const payload: any = {
        name: formData.name,
        email: formData.email,
        role: formData.role,
        department: formData.department,
        hourlyRate: parseFloat(formData.hourlyRate) || 0,
        currency: formData.currency || defaultCurrency,
        timezone: formData.timezone || null,
        businessHoursStart: formData.businessHoursEnabled ? normalizeTime(formData.businessHoursStart) : null,
        businessHoursEnd:   formData.businessHoursEnabled ? normalizeTime(formData.businessHoursEnd) : null,
        businessHoursDays:  formData.businessHoursEnabled ? formData.businessHoursDays.join(',') : null
      };

      const data = editingEmployee
        ? await api.put(url, payload)
        : await api.post(url, payload);

      if (!data.success) {
        throw new Error(data.error || 'Failed to save employee');
      }

      const savedEmployeeId = editingEmployee?.id || data.data?.id;

      // If admin picked a non-auto job role, push it via the role override endpoint.
      if (savedEmployeeId && formData.jobRoleType && formData.jobRoleType !== 'auto') {
        try {
          await api.put(`/api/roles/${savedEmployeeId}`, { roleType: formData.jobRoleType });
        } catch (roleErr) {
          console.warn('Role override failed (employee saved OK):', roleErr);
        }
      }

      setShowForm(false);
      setEditingEmployee(null);
      setFormData(emptyFormData(defaultCurrency));
      loadEmployees();
    } catch (err) {
      console.error('Error saving employee:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to save employee');
    }
  };

  const handleEdit = async (employee: Employee) => {
    setEditingEmployee(employee);

    // Parse business hours days "1,2,3,4,5" → [1,2,3,4,5]
    const daysArr = (employee.businessHoursDays || '')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => n >= 1 && n <= 7);

    // Fetch the currently detected/overridden job role so we can pre-fill the
    // dropdown. Failures here fall back silently to "auto" so editing still works
    // even if the role endpoint is flaky.
    let currentJobRole = 'auto';
    try {
      const roleRes = await api.get(`/api/roles/${employee.id}`);
      if (roleRes?.success && roleRes.data?.status === 'admin_override') {
        currentJobRole = roleRes.data.roleType || 'auto';
      }
    } catch {
      /* silent */
    }

    setFormData({
      name: employee.name,
      email: employee.email,
      role: employee.role,
      department: employee.department || '',
      hourlyRate: employee.hourlyRate?.toString() || '',
      currency: employee.currency || defaultCurrency,
      timezone: employee.timezone || '',
      businessHoursEnabled: !!(employee.businessHoursStart && employee.businessHoursEnd && daysArr.length),
      businessHoursStart: employee.businessHoursStart || '09:00',
      businessHoursEnd:   employee.businessHoursEnd   || '17:00',
      businessHoursDays:  daysArr.length > 0 ? daysArr : [1, 2, 3, 4, 5],
      jobRoleType: currentJobRole
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this employee?')) return;

    try {
      const data = await api.delete(`/api/employees/${id}`);
      if (data.success) {
        loadEmployees();
      } else {
        throw new Error(data.error || 'Failed to delete employee');
      }
    } catch (err) {
      console.error('Error deleting employee:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete employee');
    }
  };

  const handleGenerateSetupToken = async (employee: Employee) => {
    try {
      const res = await api.post('/api/auth/setup-token', { employeeId: employee.id });
      const tokenData = res.data || res;
      setSetupToken({ token: tokenData.token || tokenData.setupToken, employeeName: employee.name });
    } catch (err) {
      console.error('Error generating setup token:', err);
      alert(err instanceof Error ? err.message : 'Failed to generate setup token');
    }
  };

  const handleRevokeDevices = async (employee: Employee) => {
    const ok = window.confirm(
      `Reset device access for ${employee.name}? Their tracker will sign out and need a new setup token.`
    );
    if (!ok) return;
    try {
      const res = await api.post('/api/auth/revoke-devices', { employeeId: employee.id });
      const data = res.data || res;
      const count = data.revokedSessions ?? 0;
      alert(
        count > 0
          ? `Revoked ${count} device session(s) for ${employee.name}.`
          : `${employee.name} had no active device sessions.`
      );
    } catch (err) {
      console.error('Error revoking devices:', err);
      alert(err instanceof Error ? err.message : 'Failed to reset device access');
    }
  };

  /**
   * Zero-friction install flow for non-technical admins: clicked while the
   * admin is physically at the employee's laptop. Generates a setup token,
   * then drops an `teamtracker-activate-<ts>.json` into the admin's Downloads
   * folder. When the tracker first runs on that machine it auto-detects the
   * file, redeems the token against /api/auth/enroll, and starts tracking
   * as this employee — no copy-pasting required.
   */
  const handleInstallOnThisDevice = async (employee: Employee) => {
    try {
      const res = await api.post('/api/auth/setup-token', { employeeId: employee.id });
      const tokenData = res.data || res;
      const setupToken = tokenData.token || tokenData.setupToken;
      if (!setupToken) {
        throw new Error('Server did not return a setup token');
      }

      // Build the activation payload and trigger a browser download.
      const payload = {
        setupToken,
        serverUrl: window.location.origin,
        employeeName: employee.name,
        createdAt: new Date().toISOString()
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `teamtracker-activate-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke shortly after to make sure the download actually started.
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setInstallPrompt({ employeeName: employee.name });
    } catch (err) {
      console.error('Error preparing install:', err);
      alert(err instanceof Error ? err.message : 'Failed to prepare install');
    }
  };

  if (loading) {
    return <div className="tt-page"><p className="tt-muted">{t('common.loading')}</p></div>;
  }

  if (error) {
    return (
      <div className="tt-page">
        <div className="tt-empty">
          <EmptyIcon icon={AlertTriangle} size={40} color="var(--tt-danger)" />
          <h2 className="tt-empty-title">{t('employees.loadFailed')}</h2>
          <p className="tt-muted">{error}</p>
          <div className="tt-empty-action">
            <button type="button" className="tt-btn tt-btn-primary" onClick={loadEmployees}>
              {t('common.retry')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tt-page">
      <PageHero
        icon={Users}
        title={t('employees.title')}
        subtitle={t('employees.subtitle')}
        help={t('help.employees')}
        action={
          <button type="button" className="tt-btn tt-btn-primary" onClick={openCreate}>
            <Plus size={16} strokeWidth={2.4} />
            {t('employees.add')}
          </button>
        }
      />

      {employees.length > 0 && (
        <div className="tt-toolbar">
          <div className="tt-search">
            <Search size={16} strokeWidth={2.1} style={{ color: 'var(--tt-text-faint)', flexShrink: 0 }} />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('employees.searchPlaceholder')}
              aria-label={t('common.search')}
            />
          </div>
          <div className="tt-count-pill">
            {t('employees.count', { count: filtered.length, total: employees.length })}
          </div>
        </div>
      )}

      {showForm && (
        <div
          className="tt-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          onClick={() => setShowForm(false)}
        >
          <div className="tt-modal tt-modal--lg" onClick={e => e.stopPropagation()}>
            <div className="tt-modal-header">
              <h2 id="modal-title" className="tt-modal-title">
                {editingEmployee ? t('employees.edit') : t('employees.addTitle')}
              </h2>
              <ModalCloseButton onClick={() => setShowForm(false)} />
            </div>
            <form onSubmit={handleSubmit} noValidate style={{ display: 'contents' }}>
              <div className="tt-modal-body">
                {formError && (
                  <div style={styles.errorBanner}>
                    <StatusLine variant="error">{formError}</StatusLine>
                  </div>
                )}
                <div className="tt-modal-form tt-modal-form--2col">
                  <div className="tt-field">
                    <label className="tt-field-label">{t('employees.name')} *</label>
                    <input
                      type="text"
                      className="tt-input"
                      placeholder="e.g. John Smith"
                      value={formData.name}
                      onChange={e => setFormData({...formData, name: e.target.value})}
                      required
                    />
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">{t('employees.email')}</label>
                    <input
                      type="email"
                      className="tt-input"
                      placeholder="e.g. john@company.com (optional)"
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                    />
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">{t('employees.role')}</label>
                    <select
                      className="tt-input"
                      value={formData.role}
                      onChange={e => setFormData({...formData, role: e.target.value})}
                    >
                      <option value="employee">{t('employees.role.employee')}</option>
                      <option value="manager">{t('employees.role.manager')}</option>
                      <option value="admin">{t('employees.role.admin')}</option>
                    </select>
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">{t('employees.department')}</label>
                    <input
                      type="text"
                      className="tt-input"
                      placeholder="e.g. Engineering"
                      value={formData.department}
                      onChange={e => setFormData({...formData, department: e.target.value})}
                    />
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">{t('employees.hourlyRate')}</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <select
                        value={formData.currency}
                        onChange={e => setFormData({ ...formData, currency: e.target.value })}
                        className="tt-input"
                        style={{ flex: '0 0 110px' }}
                        aria-label="Currency"
                      >
                        {SUPPORTED_CURRENCIES.map(c => (
                          <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        className="tt-input"
                        placeholder="e.g. 50"
                        value={formData.hourlyRate}
                        onChange={e => setFormData({ ...formData, hourlyRate: e.target.value })}
                        style={{ flex: 1 }}
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">{t('employees.jobType')}</label>
                    <select
                      className="tt-input"
                      value={formData.jobRoleType}
                      onChange={e => setFormData({ ...formData, jobRoleType: e.target.value })}
                    >
                      {JOB_ROLES.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.icon}  {r.label}
                        </option>
                      ))}
                    </select>
                    <div className="tt-field-hint">
                      "Auto-detect" picks based on app usage. Override if it's wrong.
                    </div>
                  </div>
                  <div className="tt-field tt-field-span-2">
                    <label className="tt-field-label">{t('employees.timezone')}</label>
                    <select
                      className="tt-input"
                      value={formData.timezone}
                      onChange={e => setFormData({ ...formData, timezone: e.target.value })}
                    >
                      <option value="">Inherit organization ({org?.timezone || 'UTC'})</option>
                      {COMMON_TIMEZONES.map(tz => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  </div>
                  <div className="tt-field tt-field-span-2">
                    <label className="tt-field-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="checkbox"
                        checked={formData.businessHoursEnabled}
                        onChange={e => setFormData({ ...formData, businessHoursEnabled: e.target.checked })}
                      />
                      {t('employees.businessHours')}
                    </label>
                    {formData.businessHoursEnabled && (
                      <div style={styles.hoursBox}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '12px', color: 'var(--tt-text-muted)', minWidth: '40px' }}>Start</span>
                          <input
                            type="time"
                            value={formData.businessHoursStart}
                            onChange={e => setFormData({ ...formData, businessHoursStart: e.target.value })}
                            className="tt-input"
                            style={{ flex: 1, minWidth: 120 }}
                          />
                          <span style={{ fontSize: '12px', color: 'var(--tt-text-muted)', minWidth: '30px' }}>End</span>
                          <input
                            type="time"
                            value={formData.businessHoursEnd}
                            onChange={e => setFormData({ ...formData, businessHoursEnd: e.target.value })}
                            className="tt-input"
                            style={{ flex: 1, minWidth: 120 }}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {WEEKDAY_OPTIONS.map(day => {
                            const selected = formData.businessHoursDays.includes(day.value);
                            return (
                              <button
                                type="button"
                                key={day.value}
                                onClick={() => {
                                  setFormData(prev => ({
                                    ...prev,
                                    businessHoursDays: selected
                                      ? prev.businessHoursDays.filter(d => d !== day.value)
                                      : [...prev.businessHoursDays, day.value].sort()
                                  }));
                                }}
                                style={{
                                  ...styles.dayChip,
                                  backgroundColor: selected ? 'var(--tt-ink)' : 'var(--tt-surface)',
                                  color: selected ? '#fff' : 'var(--tt-text-muted)',
                                }}
                              >
                                {day.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="tt-field-hint">
                          Activity outside these hours is stored but shown separately in Reports.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="tt-modal-footer">
                <button type="button" className="tt-btn tt-btn-ghost" onClick={() => setShowForm(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="tt-btn tt-btn-primary">
                  {editingEmployee ? t('common.update') : t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {setupToken && (
        <div
          className="tt-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setSetupToken(null)}
        >
          <div className="tt-modal tt-modal--md" onClick={e => e.stopPropagation()}>
            <div className="tt-modal-header">
              <h2 className="tt-modal-title">{t('employees.setupToken')} — {setupToken.employeeName}</h2>
              <ModalCloseButton onClick={() => setSetupToken(null)} />
            </div>
            <div className="tt-modal-body">
              <div style={styles.tokenBox}>{setupToken.token}</div>
              <div style={styles.infoCallout}>
                <p style={{ fontSize: '13px', color: 'var(--tt-text)', margin: '0 0 8px', lineHeight: '1.5' }}>
                  {t('employees.tokenShare', { name: setupToken.employeeName })}
                </p>
                <p style={{ fontSize: '12px', color: 'var(--tt-text-muted)', margin: 0, lineHeight: '1.5' }}>
                  {t('employees.tokenExpiry')}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const }}>
                <a
                  href="/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tt-btn tt-btn-primary"
                  style={{ textDecoration: 'none' }}
                >
                  {t('employees.downloadTracker')}
                </a>
                <a
                  href="https://github.com/hamdymohamedak/TeamTracker#3-install-the-desktop-tracker"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tt-btn tt-btn-ghost"
                  style={{ textDecoration: 'none' }}
                >
                  {t('employees.setupInstructions')}
                </a>
              </div>
            </div>
            <div className="tt-modal-footer">
              <button type="button" className="tt-btn tt-btn-ghost" onClick={() => setSetupToken(null)}>{t('common.close')}</button>
              <button
                type="button"
                className="tt-btn tt-btn-primary"
                onClick={() => navigator.clipboard.writeText(setupToken.token)}
              >
                {t('employees.copyToken')}
              </button>
            </div>
          </div>
        </div>
      )}

      {installPrompt && (
        <div
          className="tt-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setInstallPrompt(null)}
        >
          <div className="tt-modal tt-modal--md" onClick={e => e.stopPropagation()}>
            <div className="tt-modal-header">
              <h2 className="tt-modal-title">{t('employees.installDevice')}</h2>
              <ModalCloseButton onClick={() => setInstallPrompt(null)} />
            </div>
            <div className="tt-modal-body">
              <p style={{ color: 'var(--tt-text)', margin: '0 0 12px', fontSize: '14px', lineHeight: 1.5 }}>
                An activation file for <strong>{installPrompt.employeeName}</strong> has been saved to your Downloads folder.
              </p>
              <div style={styles.successCallout}>
                <div style={{ fontWeight: 650, marginBottom: '6px' }}>Next steps on this laptop:</div>
                <ol style={{ margin: 0, paddingLeft: '18px' }}>
                  <li>Click the button below to download the TeamTracker installer</li>
                  <li>Run the installer</li>
                  <li>That's it — the tracker will auto-connect as <strong>{installPrompt.employeeName}</strong> on first launch</li>
                </ol>
              </div>
            </div>
            <div className="tt-modal-footer">
              <button type="button" className="tt-btn tt-btn-ghost" onClick={() => setInstallPrompt(null)}>{t('common.close')}</button>
              <a href="/download" target="_blank" rel="noopener noreferrer" className="tt-btn tt-btn-primary" style={{ textDecoration: 'none' }}>
                Download Installer
              </a>
            </div>
          </div>
        </div>
      )}

      {employees.length === 0 ? (
        <PageEmpty
          icon={Users}
          title={t('employees.empty')}
          hint={t('employees.emptyHint')}
          action={
            <button type="button" className="tt-btn tt-btn-primary" onClick={openCreate}>
              <Plus size={16} strokeWidth={2.4} />
              {t('employees.addFirst')}
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <div className="tt-empty">
          <p className="tt-muted">{t('employees.noSearchResults')}</p>
        </div>
      ) : (
        <div className="tt-card-grid">
          {filtered.map(employee => (
            <article key={employee.id} className="tt-entity-card">
              <div style={styles.cardTop}>
                <div style={styles.avatar}>{initials(employee.name)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={styles.nameRow}>
                    <h3 style={styles.employeeName}>{employee.name}</h3>
                    <span style={roleBadgeStyle(employee.role)}>{employee.role}</span>
                  </div>
                  <p style={styles.emailLine}>
                    <Mail size={13} strokeWidth={2.1} />
                    <span>{employee.email || '—'}</span>
                  </p>
                </div>
              </div>

              <div className="tt-meta-chips">
                {employee.department && (
                  <span className="tt-chip"><Building2 size={12} />{employee.department}</span>
                )}
                {employee.hourlyRate ? (
                  <span className="tt-chip">
                    {formatCurrency(employee.hourlyRate, employee.currency || defaultCurrency)}/hr
                  </span>
                ) : null}
                {employee.businessHoursStart && employee.businessHoursEnd ? (
                  <span className="tt-chip">
                    <Clock size={12} />
                    {employee.businessHoursStart}–{employee.businessHoursEnd}
                  </span>
                ) : null}
                {employee.timezone ? (
                  <span className="tt-chip"><Globe size={12} />{employee.timezone}</span>
                ) : null}
              </div>

              <div className="tt-entity-card-actions">
                <button type="button" onClick={() => handleEdit(employee)} className="tt-action-btn" title={t('common.edit')}>
                  <Pencil size={14} strokeWidth={2.1} />
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  onClick={() => handleInstallOnThisDevice(employee)}
                  className="tt-action-btn"
                  title={t('employees.installDevice')}
                >
                  <Download size={14} strokeWidth={2.1} />
                  {t('employees.installDevice')}
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerateSetupToken(employee)}
                  className="tt-action-btn"
                  title={t('employees.setupToken')}
                >
                  <KeyRound size={14} strokeWidth={2.1} />
                  {t('employees.setupToken')}
                </button>
                <button
                  type="button"
                  onClick={() => handleRevokeDevices(employee)}
                  className="tt-action-btn"
                  style={{ borderColor: 'rgba(180,140,40,0.35)', background: 'rgba(180,140,40,0.08)', color: '#8a6d1a' }}
                  title={t('employees.revokeDevicesHint')}
                >
                  <ShieldOff size={14} strokeWidth={2.1} />
                  {t('employees.revokeDevices')}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(employee.id)}
                  className="tt-action-btn tt-action-btn-danger"
                  title={t('common.delete')}
                >
                  <Trash2 size={14} strokeWidth={2.1} />
                  {t('common.delete')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

function roleBadgeStyle(role: string): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    borderRadius: 999,
    padding: '4px 8px',
    flexShrink: 0,
  };
  if (role === 'admin') return { ...base, background: 'var(--tt-danger-soft)', color: 'var(--tt-danger)' };
  if (role === 'manager') return { ...base, background: 'rgba(180,140,40,0.12)', color: '#8a6d1a' };
  return { ...base, background: 'var(--tt-surface-muted)', color: 'var(--tt-text-muted)', border: '1px solid var(--tt-border)' };
}

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    padding: 'clamp(20px, 4vw, 36px)',
    maxWidth: 1100,
    margin: '0 auto',
  },
  muted: { color: 'var(--tt-text-muted)', fontSize: 14, lineHeight: 1.5, margin: 0 },
  hero: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 22,
    flexWrap: 'wrap',
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
    maxWidth: 560,
  },
  primaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '11px 16px',
    background: 'var(--tt-ink)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 650,
    cursor: 'pointer',
    flexShrink: 0,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 220,
    padding: '10px 12px',
    borderRadius: 12,
    border: '1px solid var(--tt-border)',
    background: 'var(--tt-surface)',
    boxShadow: 'var(--tt-shadow-sm)',
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    width: '100%',
    fontSize: 14,
    color: 'var(--tt-text)',
  },
  countPill: {
    fontSize: 12,
    fontWeight: 650,
    color: 'var(--tt-text-muted)',
    background: 'var(--tt-surface-muted)',
    border: '1px solid var(--tt-border)',
    borderRadius: 999,
    padding: '8px 12px',
  },
  errorBanner: {
    backgroundColor: 'var(--tt-danger-soft)',
    border: '1px solid rgba(232, 93, 76, 0.25)',
    color: 'var(--tt-danger)',
    padding: '12px 16px',
    borderRadius: 'var(--tt-radius-sm)',
    marginBottom: '16px',
    fontWeight: 500,
  },
  errorPanel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    textAlign: 'center',
    padding: '48px 20px',
    background: 'var(--tt-surface)',
    border: '1px solid var(--tt-border)',
    borderRadius: 'var(--tt-radius-lg)',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 650,
    color: 'var(--tt-danger)',
    margin: 0,
  },
  hoursBox: {
    marginTop: 8,
    padding: 12,
    backgroundColor: 'var(--tt-surface-muted)',
    borderRadius: 'var(--tt-radius-sm)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  dayChip: {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid var(--tt-border-strong)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    minHeight: 36,
  },
  tokenBox: {
    backgroundColor: 'var(--tt-surface-muted)',
    border: '1px solid var(--tt-border-strong)',
    borderRadius: 'var(--tt-radius-sm)',
    padding: 16,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13,
    wordBreak: 'break-all',
    color: 'var(--tt-text)',
    marginBottom: 12,
  },
  infoCallout: {
    backgroundColor: 'var(--tt-info-soft)',
    border: '1px solid var(--tt-border)',
    borderRadius: 'var(--tt-radius-sm)',
    padding: '14px 16px',
    marginBottom: 12,
  },
  successCallout: {
    backgroundColor: 'var(--tt-success-soft)',
    border: '1px solid rgba(31, 169, 113, 0.3)',
    borderRadius: 'var(--tt-radius-sm)',
    padding: '12px 14px',
    fontSize: 13,
    color: 'var(--tt-success)',
    lineHeight: 1.5,
  },
  emptyPanel: {
    textAlign: 'center',
    padding: '56px 20px',
    background: 'var(--tt-surface)',
    border: '1px dashed var(--tt-border-strong)',
    borderRadius: 'var(--tt-radius-lg)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 650,
    color: 'var(--tt-text)',
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 14,
  },
  card: {
    background: 'var(--tt-surface)',
    border: '1px solid var(--tt-border)',
    borderRadius: 'var(--tt-radius-lg)',
    boxShadow: 'var(--tt-shadow-sm)',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: 'var(--tt-ink)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    flexShrink: 0,
  },
  nameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  employeeName: {
    margin: 0,
    fontSize: 16,
    fontWeight: 650,
    color: 'var(--tt-text)',
    letterSpacing: '-0.01em',
  },
  emailLine: {
    margin: '6px 0 0',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--tt-text-muted)',
    minWidth: 0,
  },
  metaChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--tt-text-muted)',
    background: 'var(--tt-surface-muted)',
    border: '1px solid var(--tt-border)',
    borderRadius: 999,
    padding: '5px 9px',
  },
  cardActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 'auto',
    paddingTop: 4,
    borderTop: '1px solid var(--tt-border)',
  },
  actionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 10px',
    borderRadius: 8,
    border: '1px solid var(--tt-border-strong)',
    background: 'var(--tt-surface-muted)',
    color: 'var(--tt-text)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  actionBtnWarn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 10px',
    borderRadius: 8,
    border: '1px solid rgba(180,140,40,0.35)',
    background: 'rgba(180,140,40,0.08)',
    color: '#8a6d1a',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  actionBtnDanger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 10px',
    borderRadius: 8,
    border: '1px solid rgba(181,74,63,0.25)',
    background: 'var(--tt-danger-soft)',
    color: 'var(--tt-danger)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
