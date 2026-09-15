import React, { useState, useEffect } from 'react';
import type { Employee } from '../../../shared-types';
import { SUPPORTED_CURRENCIES, formatCurrency, JOB_ROLES } from '../../../shared-types';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

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

  useEffect(() => {
    loadEmployees();
  }, []);

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
    return <div style={styles.loading}>Loading...</div>;
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={errorStyles.container}>
          <div style={errorStyles.icon}>⚠️</div>
          <h2 style={errorStyles.title}>Error Loading Employees</h2>
          <p style={errorStyles.message}>{error}</p>
          <button onClick={loadEmployees} style={errorStyles.retryButton}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Employees</h1>
        <button
          style={styles.addButton}
          onClick={() => {
            setEditingEmployee(null);
            setFormData(emptyFormData(defaultCurrency));
            setShowForm(true);
          }}
        >
          + Add Employee
        </button>
      </header>

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
                {editingEmployee ? 'Edit Employee' : 'Add Employee'}
              </h2>
              <button type="button" className="tt-modal-close" aria-label="Close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit} noValidate style={{ display: 'contents' }}>
              <div className="tt-modal-body">
                {formError && (
                  <div style={styles.errorBanner}>
                    ⚠️ {formError}
                  </div>
                )}
                <div className="tt-modal-form tt-modal-form--2col">
                  <div className="tt-field">
                    <label className="tt-field-label">Name *</label>
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
                    <label className="tt-field-label">Email</label>
                    <input
                      type="email"
                      className="tt-input"
                      placeholder="e.g. john@company.com (optional)"
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                    />
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">Role</label>
                    <select
                      className="tt-input"
                      value={formData.role}
                      onChange={e => setFormData({...formData, role: e.target.value})}
                    >
                      <option value="employee">Employee</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">Department</label>
                    <input
                      type="text"
                      className="tt-input"
                      placeholder="e.g. Engineering"
                      value={formData.department}
                      onChange={e => setFormData({...formData, department: e.target.value})}
                    />
                  </div>
                  <div className="tt-field">
                    <label className="tt-field-label">Hourly Rate</label>
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
                    <label className="tt-field-label">Job Type</label>
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
                    <label className="tt-field-label">Timezone</label>
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
                      Restrict tracking to business hours
                    </label>
                    {formData.businessHoursEnabled && (
                      <div style={{
                        marginTop: '4px',
                        padding: '12px',
                        backgroundColor: 'var(--tt-surface-muted)',
                        borderRadius: 'var(--tt-radius-sm)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                      }}>
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
                                  padding: '6px 12px',
                                  borderRadius: '8px',
                                  border: '1px solid var(--tt-border-strong)',
                                  cursor: 'pointer',
                                  backgroundColor: selected ? 'var(--tt-teal)' : 'var(--tt-surface)',
                                  color: selected ? '#fff' : 'var(--tt-text-muted)',
                                  fontSize: '12px',
                                  fontWeight: 500,
                                  minHeight: 36,
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
                  Cancel
                </button>
                <button type="submit" className="tt-btn tt-btn-primary">
                  {editingEmployee ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Setup Token Modal */}
      {setupToken && (
        <div
          className="tt-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setSetupToken(null)}
        >
          <div className="tt-modal tt-modal--md" onClick={e => e.stopPropagation()}>
            <div className="tt-modal-header">
              <h2 className="tt-modal-title">Setup Token for {setupToken.employeeName}</h2>
              <button type="button" className="tt-modal-close" aria-label="Close" onClick={() => setSetupToken(null)}>✕</button>
            </div>
            <div className="tt-modal-body">
              <div style={{
                backgroundColor: 'var(--tt-surface-muted)',
                border: '1px solid var(--tt-border-strong)',
                borderRadius: 'var(--tt-radius-sm)',
                padding: '16px',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '13px',
                wordBreak: 'break-all' as const,
                color: 'var(--tt-text)',
                marginBottom: '12px',
              }}>
                {setupToken.token}
              </div>
              <div style={{
                backgroundColor: 'var(--tt-info-soft)',
                border: '1px solid rgba(42, 143, 214, 0.25)',
                borderRadius: 'var(--tt-radius-sm)',
                padding: '14px 16px',
                marginBottom: '12px',
              }}>
                <p style={{ fontSize: '13px', color: 'var(--tt-text)', margin: '0 0 8px', lineHeight: '1.5' }}>
                  Share this token with <strong>{setupToken.employeeName}</strong>. They will need it to connect their desktop app.
                </p>
                <p style={{ fontSize: '12px', color: 'var(--tt-text-muted)', margin: 0, lineHeight: '1.5' }}>
                  The token expires in 7 days and can only be used once.
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
                  Download Tracker App
                </a>
                <a
                  href="https://github.com/hamdymohamedak/TeamTracker#3-install-the-desktop-tracker"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tt-btn tt-btn-ghost"
                  style={{ textDecoration: 'none' }}
                >
                  Setup instructions →
                </a>
              </div>
            </div>
            <div className="tt-modal-footer">
              <button type="button" className="tt-btn tt-btn-ghost" onClick={() => setSetupToken(null)}>Close</button>
              <button
                type="button"
                className="tt-btn tt-btn-primary"
                onClick={() => navigator.clipboard.writeText(setupToken.token)}
              >
                Copy Token
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Install on this Device — post-click modal */}
      {installPrompt && (
        <div
          className="tt-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setInstallPrompt(null)}
        >
          <div className="tt-modal tt-modal--md" onClick={e => e.stopPropagation()}>
            <div className="tt-modal-header">
              <h2 className="tt-modal-title">Install on this Device</h2>
              <button type="button" className="tt-modal-close" aria-label="Close" onClick={() => setInstallPrompt(null)}>✕</button>
            </div>
            <div className="tt-modal-body">
              <p style={{ color: 'var(--tt-text)', margin: '0 0 12px', fontSize: '14px', lineHeight: 1.5 }}>
                An activation file for <strong>{installPrompt.employeeName}</strong> has been saved to your Downloads folder.
              </p>
              <div style={{
                backgroundColor: 'var(--tt-success-soft)',
                border: '1px solid rgba(31, 169, 113, 0.3)',
                borderRadius: 'var(--tt-radius-sm)',
                padding: '12px 14px',
                fontSize: '13px',
                color: 'var(--tt-success)',
                lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 650, marginBottom: '6px' }}>Next steps on this laptop:</div>
                <ol style={{ margin: 0, paddingLeft: '18px' }}>
                  <li>Click the button below to download the TeamTracker installer</li>
                  <li>Run the installer</li>
                  <li>That's it — the tracker will auto-connect as <strong>{installPrompt.employeeName}</strong> on first launch</li>
                </ol>
              </div>
            </div>
            <div className="tt-modal-footer">
              <button type="button" className="tt-btn tt-btn-ghost" onClick={() => setInstallPrompt(null)}>Close</button>
              <a href="/download" target="_blank" rel="noopener noreferrer" className="tt-btn tt-btn-primary" style={{ textDecoration: 'none' }}>
                Download Installer
              </a>
            </div>
          </div>
        </div>
      )}

      {employees.length === 0 && (
        <div style={{
          textAlign: 'center' as const,
          padding: '60px 20px',
          backgroundColor: 'var(--tt-surface)',
          borderRadius: 'var(--tt-radius)',
          boxShadow: 'var(--tt-shadow-sm)',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>👥</div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--tt-text)', margin: '0 0 8px' }}>
            No employees yet
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--tt-text-muted)', margin: '0 0 24px' }}>
            Add your first team member to start tracking.
          </p>
          <button
            onClick={() => {
              setEditingEmployee(null);
              setFormData(emptyFormData(defaultCurrency));
              setShowForm(true);
            }}
            style={{
              padding: '12px 32px',
              backgroundColor: 'var(--tt-success)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--tt-radius-sm)',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: 600,
            }}
          >
            + Add Employee
          </button>
        </div>
      )}

      <div style={styles.grid}>
        {employees.map(employee => (
          <div key={employee.id} style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.employeeName}>{employee.name}</h3>
              <span style={styles.roleBadge(employee.role)}>{employee.role}</span>
            </div>
            <div style={styles.cardBody}>
              <p style={styles.info}>📧 {employee.email}</p>
              {employee.department && <p style={styles.info}>🏢 {employee.department}</p>}
              {employee.hourlyRate ? (
                <p style={styles.info}>
                  💰 {formatCurrency(employee.hourlyRate, employee.currency || defaultCurrency)}/hr
                </p>
              ) : null}
              {employee.businessHoursStart && employee.businessHoursEnd && employee.businessHoursDays ? (
                <p style={styles.info}>
                  🕘 {employee.businessHoursStart}–{employee.businessHoursEnd}
                  {' '}({employee.businessHoursDays})
                </p>
              ) : null}
              {employee.timezone ? (
                <p style={{ ...styles.info, fontSize: '12px', color: 'var(--tt-text-faint)' }}>
                  🌐 {employee.timezone}
                </p>
              ) : null}
            </div>
            <div style={styles.cardActions}>
              <button onClick={() => handleEdit(employee)} style={styles.editButton}>
                Edit
              </button>
              <button
                onClick={() => handleInstallOnThisDevice(employee)}
                style={styles.installButton}
                title="Use this when you're sitting at this employee's laptop. Downloads an activation file and the tracker will auto-connect on first launch."
              >
                Install on this Device
              </button>
              <button onClick={() => handleGenerateSetupToken(employee)} style={styles.setupButton}>
                Setup Token
              </button>
              <button onClick={() => handleDelete(employee.id)} style={styles.deleteButton}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const errorStyles: { [key: string]: React.CSSProperties } = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
    textAlign: 'center'
  },
  icon: {
    fontSize: '48px',
    marginBottom: '16px'
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
    color: 'var(--tt-danger)',
    marginBottom: '8px'
  },
  message: {
    fontSize: '16px',
    color: 'var(--tt-text-muted)',
    marginBottom: '24px'
  },
  retryButton: {
    padding: '12px 24px',
    backgroundColor: 'var(--tt-teal)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--tt-radius-sm)',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer'
  }
};

const styles: { [key: string]: React.CSSProperties | any } = {
  container: {
    padding: '32px'
  },
  loading: {
    padding: '40px',
    textAlign: 'center'
  },
  errorBanner: {
    backgroundColor: 'var(--tt-danger-soft)',
    border: '1px solid rgba(232, 93, 76, 0.25)',
    color: 'var(--tt-danger)',
    padding: '12px 16px',
    borderRadius: 'var(--tt-radius-sm)',
    marginBottom: '16px',
    fontWeight: 500
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  },
  title: {
    fontSize: 'clamp(1.5rem, 2.2vw, 1.9rem)',
    fontWeight: 750,
    fontFamily: 'var(--tt-font-display)',
    letterSpacing: '-0.02em',
    color: 'var(--tt-text)'
  },
  addButton: {
    padding: '12px 24px',
    backgroundColor: 'var(--tt-success)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--tt-radius-sm)',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500
  },
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000
  },
  modalContent: {
    backgroundColor: 'var(--tt-surface)',
    padding: '32px',
    borderRadius: 'var(--tt-radius)',
    width: '100%',
    maxWidth: '400px'
  },
  modalTitle: {
    marginBottom: '20px',
    color: 'var(--tt-text)'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--tt-text-muted)'
  },
  input: {
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px'
  },
  formButtons: {
    display: 'flex',
    gap: '12px',
    marginTop: '8px'
  },
  cancelButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: 'var(--tt-surface-muted)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  saveButton: {
    flex: 1,
    padding: '12px',
    backgroundColor: 'var(--tt-success)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 500
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '16px'
  },
  card: {
    backgroundColor: 'var(--tt-surface)',
    padding: '20px',
    borderRadius: 'var(--tt-radius)',
    boxShadow: 'var(--tt-shadow-sm)'
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  employeeName: {
    fontSize: '18px',
    fontWeight: 600,
    color: 'var(--tt-text)'
  },
  roleBadge: (role: string) => ({
    padding: '4px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    backgroundColor: role === 'admin' ? 'var(--tt-danger)' : role === 'manager' ? 'var(--tt-amber)' : 'var(--tt-teal)',
    color: '#fff'
  }),
  cardBody: {
    marginBottom: '16px'
  },
  info: {
    fontSize: '14px',
    color: 'var(--tt-text-muted)',
    margin: '4px 0'
  },
  cardActions: {
    display: 'flex',
    gap: '8px'
  },
  editButton: {
    flex: 1,
    padding: '8px',
    backgroundColor: 'var(--tt-teal)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  setupButton: {
    flex: 1,
    padding: '8px',
    backgroundColor: '#8e44ad',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  },
  installButton: {
    flex: 1.4,
    padding: '8px',
    backgroundColor: 'var(--tt-success)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600
  },
  deleteButton: {
    flex: 1,
    padding: '8px',
    backgroundColor: 'var(--tt-danger)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px'
  }
};
