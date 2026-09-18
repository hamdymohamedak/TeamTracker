import React from 'react';
import { SUPPORTED_CURRENCIES, JOB_ROLES } from '../../../../../shared-types';
import { useI18n } from '@/contexts/I18nContext';
import { ModalCloseButton, StatusLine } from '@/components/Icon';
import { COMMON_TIMEZONES, WEEKDAY_OPTIONS } from '../constants';
import type { EmployeeFormData } from '../types';

interface Props {
  showForm: boolean;
  editingEmployee: { id: string; name: string } | null;
  formData: EmployeeFormData;
  setFormData: React.Dispatch<React.SetStateAction<EmployeeFormData>>;
  formError: string | null;
  orgTimezone: string;
  defaultCurrency: string;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
}

export const EmployeeFormDialog: React.FC<Props> = ({
  showForm,
  editingEmployee,
  formData,
  setFormData,
  formError,
  orgTimezone,
  onClose,
  onSubmit,
}) => {
  const { t } = useI18n();

  if (!showForm) return null;

  return (
    <div
      className="tt-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      <div className="tt-modal tt-modal--lg" onClick={e => e.stopPropagation()}>
        <div className="tt-modal-header">
          <h2 id="modal-title" className="tt-modal-title">
            {editingEmployee ? t('employees.edit') : t('employees.addTitle')}
          </h2>
          <ModalCloseButton onClick={onClose} />
        </div>

        <form onSubmit={onSubmit} noValidate style={{ display: 'contents' }}>
          <div className="tt-modal-body">
            {formError && (
              <div style={styles.errorBanner}>
                <StatusLine variant="error">{formError}</StatusLine>
              </div>
            )}

            <div className="tt-modal-form tt-modal-form--2col">
              {/* Name */}
              <div className="tt-field">
                <label className="tt-field-label">{t('employees.name')} *</label>
                <input
                  type="text"
                  className="tt-input"
                  placeholder="e.g. John Smith"
                  value={formData.name}
                  onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                  required
                />
              </div>

              {/* Email */}
              <div className="tt-field">
                <label className="tt-field-label">{t('employees.email')}</label>
                <input
                  type="email"
                  className="tt-input"
                  placeholder="e.g. john@company.com (optional)"
                  value={formData.email}
                  onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                />
              </div>

              {/* Role */}
              <div className="tt-field">
                <label className="tt-field-label">{t('employees.role')}</label>
                <select
                  className="tt-input"
                  value={formData.role}
                  onChange={e => setFormData(p => ({ ...p, role: e.target.value }))}
                >
                  <option value="employee">{t('employees.role.employee')}</option>
                  <option value="manager">{t('employees.role.manager')}</option>
                  <option value="admin">{t('employees.role.admin')}</option>
                </select>
              </div>

              {/* Department */}
              <div className="tt-field">
                <label className="tt-field-label">{t('employees.department')}</label>
                <input
                  type="text"
                  className="tt-input"
                  placeholder="e.g. Engineering"
                  value={formData.department}
                  onChange={e => setFormData(p => ({ ...p, department: e.target.value }))}
                />
              </div>

              {/* Hourly rate + currency */}
              <div className="tt-field">
                <label className="tt-field-label">{t('employees.hourlyRate')}</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    value={formData.currency}
                    onChange={e => setFormData(p => ({ ...p, currency: e.target.value }))}
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
                    onChange={e => setFormData(p => ({ ...p, hourlyRate: e.target.value }))}
                    style={{ flex: 1 }}
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              {/* Job role type */}
              <div className="tt-field">
                <label className="tt-field-label">{t('employees.jobType')}</label>
                <select
                  className="tt-input"
                  value={formData.jobRoleType}
                  onChange={e => setFormData(p => ({ ...p, jobRoleType: e.target.value }))}
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

              {/* Timezone */}
              <div className="tt-field tt-field-span-2">
                <label className="tt-field-label">{t('employees.timezone')}</label>
                <select
                  className="tt-input"
                  value={formData.timezone}
                  onChange={e => setFormData(p => ({ ...p, timezone: e.target.value }))}
                >
                  <option value="">Inherit organization ({orgTimezone})</option>
                  {COMMON_TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>

              {/* Business hours */}
              <div className="tt-field tt-field-span-2">
                <label className="tt-field-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={formData.businessHoursEnabled}
                    onChange={e => setFormData(p => ({ ...p, businessHoursEnabled: e.target.checked }))}
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
                        onChange={e => setFormData(p => ({ ...p, businessHoursStart: e.target.value }))}
                        className="tt-input"
                        style={{ flex: 1, minWidth: 120 }}
                      />
                      <span style={{ fontSize: '12px', color: 'var(--tt-text-muted)', minWidth: '30px' }}>End</span>
                      <input
                        type="time"
                        value={formData.businessHoursEnd}
                        onChange={e => setFormData(p => ({ ...p, businessHoursEnd: e.target.value }))}
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
                                  : [...prev.businessHoursDays, day.value].sort(),
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
            <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="tt-btn tt-btn-primary">
              {editingEmployee ? t('common.update') : t('common.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  errorBanner: {
    backgroundColor: 'var(--tt-danger-soft)',
    border: '1px solid rgba(232, 93, 76, 0.25)',
    color: 'var(--tt-danger)',
    padding: '12px 16px',
    borderRadius: 'var(--tt-radius-sm)',
    marginBottom: '16px',
    fontWeight: 500,
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
};
