import React from 'react';
import { AlertTriangle, Plus, Users } from 'lucide-react';
import { useI18n } from '@/contexts/I18nContext';
import { EmptyIcon } from '@/components/Icon';
import { PageHero } from '@/components/PageHero';
import {
  useEmployees,
  EmployeeToolbar,
  EmployeeFormDialog,
  EmployeeSetupActions,
  EmployeeList,
  LanNetworkBanner,
} from '@/features/employees';

export const Employees: React.FC = () => {
  const { t } = useI18n();
  const emp = useEmployees();

  if (emp.loading) {
    return <div className="tt-page"><p className="tt-muted">{t('common.loading')}</p></div>;
  }

  if (emp.error) {
    return (
      <div className="tt-page">
        <div className="tt-empty">
          <EmptyIcon icon={AlertTriangle} size={40} color="var(--tt-danger)" />
          <h2 className="tt-empty-title">{t('employees.loadFailed')}</h2>
          <p className="tt-muted">{emp.error}</p>
          <div className="tt-empty-action">
            <button type="button" className="tt-btn tt-btn-primary" onClick={emp.loadEmployees}>
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
          <button type="button" className="tt-btn tt-btn-primary" onClick={emp.openCreate}>
            <Plus size={16} strokeWidth={2.4} />
            {t('employees.add')}
          </button>
        }
      />

      <LanNetworkBanner />

      {emp.employees.length > 0 && (
        <EmployeeToolbar
          query={emp.query}
          setQuery={emp.setQuery}
          totalCount={emp.employees.length}
          filteredCount={emp.filtered.length}
        />
      )}

      <EmployeeFormDialog
        showForm={emp.showForm}
        editingEmployee={emp.editingEmployee}
        formData={emp.formData}
        setFormData={emp.setFormData}
        formError={emp.formError}
        orgTimezone={emp.orgTimezone}
        defaultCurrency={emp.defaultCurrency}
        onClose={emp.closeForm}
        onSubmit={emp.handleSubmit}
      />

      <EmployeeSetupActions
        setupToken={emp.setupToken}
        setSetupToken={emp.setSetupToken}
        installPrompt={emp.installPrompt}
        setInstallPrompt={emp.setInstallPrompt}
      />

      <EmployeeList
        employees={emp.employees}
        filtered={emp.filtered}
        defaultCurrency={emp.defaultCurrency}
        onEdit={emp.handleEdit}
        onDelete={emp.handleDelete}
        onGenerateSetupToken={emp.handleGenerateSetupToken}
        onRevokeDevices={emp.handleRevokeDevices}
        onInstallOnThisDevice={emp.handleInstallOnThisDevice}
        onOpenCreate={emp.openCreate}
      />
    </div>
  );
};
