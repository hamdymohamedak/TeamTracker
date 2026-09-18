import React from 'react';
import type { Employee } from '../../../../../shared-types';
import { formatCurrency } from '../../../../../shared-types';
import { useI18n } from '@/contexts/I18nContext';
import { PageEmpty } from '@/components/PageHero';
import {
  Building2,
  Clock,
  Download,
  Globe,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  ShieldOff,
  Trash2,
  Users,
} from 'lucide-react';

interface Props {
  employees: Employee[];
  filtered: Employee[];
  defaultCurrency: string;
  onEdit: (employee: Employee) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onGenerateSetupToken: (employee: Employee) => Promise<void>;
  onRevokeDevices: (employee: Employee) => Promise<void>;
  onInstallOnThisDevice: (employee: Employee) => Promise<void>;
  onOpenCreate: () => void;
}

function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

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

export const EmployeeList: React.FC<Props> = ({
  employees,
  filtered,
  defaultCurrency,
  onEdit,
  onDelete,
  onGenerateSetupToken,
  onRevokeDevices,
  onInstallOnThisDevice,
  onOpenCreate,
}) => {
  const { t } = useI18n();

  if (employees.length === 0) {
    return (
      <PageEmpty
        icon={Users}
        title={t('employees.empty')}
        hint={t('employees.emptyHint')}
        action={
          <button type="button" className="tt-btn tt-btn-primary" onClick={onOpenCreate}>
            <Plus size={16} strokeWidth={2.4} />
            {t('employees.addFirst')}
          </button>
        }
      />
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="tt-empty">
        <p className="tt-muted">{t('employees.noSearchResults')}</p>
      </div>
    );
  }

  return (
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
            <button
              type="button"
              onClick={() => onEdit(employee)}
              className="tt-action-btn"
              title={t('common.edit')}
            >
              <Pencil size={14} strokeWidth={2.1} />
              {t('common.edit')}
            </button>
            <button
              type="button"
              onClick={() => onInstallOnThisDevice(employee)}
              className="tt-action-btn"
              title={t('employees.installDevice')}
            >
              <Download size={14} strokeWidth={2.1} />
              {t('employees.installDevice')}
            </button>
            <button
              type="button"
              onClick={() => onGenerateSetupToken(employee)}
              className="tt-action-btn"
              title={t('employees.setupToken')}
            >
              <KeyRound size={14} strokeWidth={2.1} />
              {t('employees.setupToken')}
            </button>
            <button
              type="button"
              onClick={() => onRevokeDevices(employee)}
              className="tt-action-btn"
              style={{ borderColor: 'rgba(180,140,40,0.35)', background: 'rgba(180,140,40,0.08)', color: '#8a6d1a' }}
              title={t('employees.revokeDevicesHint')}
            >
              <ShieldOff size={14} strokeWidth={2.1} />
              {t('employees.revokeDevices')}
            </button>
            <button
              type="button"
              onClick={() => onDelete(employee.id)}
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
  );
};

const styles: Record<string, React.CSSProperties> = {
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
};
