import React, { useState, useEffect, useMemo } from 'react';
import type { Employee } from '../../../../../shared-types';
import { api } from '@/lib/api';
import { buildActivationPayload, getPreferredActivationServerUrl } from '@/lib/lanInfo';
import { useAuth } from '@/contexts/AuthContext';
import { emptyFormData } from '../constants';
import type { EmployeeFormData, InstallPromptState, SetupTokenState, UseEmployeesReturn } from '../types';

export function useEmployees(): UseEmployeesReturn {
  const { org } = useAuth();
  const defaultCurrency = org?.defaultCurrency || 'USD';
  const orgTimezone = org?.timezone || 'UTC';

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // form
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [formData, setFormData] = useState<EmployeeFormData>(emptyFormData(defaultCurrency));
  const [formError, setFormError] = useState<string | null>(null);

  // setup actions
  const [setupToken, setSetupToken] = useState<SetupTokenState | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptState | null>(null);

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const openCreate = () => {
    setEditingEmployee(null);
    setFormData(emptyFormData(defaultCurrency));
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingEmployee(null);
    setFormData(emptyFormData(defaultCurrency));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.name.trim()) {
      setFormError('Name is required');
      return;
    }
    if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setFormError('Please enter a valid email address');
      return;
    }
    if (formData.businessHoursEnabled) {
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

    // Normalize HH:MM:SS → HH:MM
    const normalizeTime = (v: string) => v.replace(/^(\d{1,2}:\d{2}).*$/, '$1').padStart(5, '0');

    const url = editingEmployee
      ? `/api/employees/${editingEmployee.id}`
      : '/api/employees';

    try {
      const payload: Record<string, unknown> = {
        name: formData.name,
        email: formData.email,
        role: formData.role,
        department: formData.department,
        hourlyRate: parseFloat(formData.hourlyRate) || 0,
        currency: formData.currency || defaultCurrency,
        timezone: formData.timezone || null,
        businessHoursStart: formData.businessHoursEnabled ? normalizeTime(formData.businessHoursStart) : null,
        businessHoursEnd:   formData.businessHoursEnabled ? normalizeTime(formData.businessHoursEnd) : null,
        businessHoursDays:  formData.businessHoursEnabled ? formData.businessHoursDays.join(',') : null,
      };

      const data = editingEmployee
        ? await api.put(url, payload)
        : await api.post(url, payload);

      if (!data.success) {
        throw new Error(data.error || 'Failed to save employee');
      }

      const savedEmployeeId = editingEmployee?.id || data.data?.id;
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

    const daysArr = (employee.businessHoursDays || '')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => n >= 1 && n <= 7);

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
      jobRoleType: currentJobRole,
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
      const serverUrl = await getPreferredActivationServerUrl();
      setSetupToken({
        token: tokenData.token || tokenData.setupToken,
        employeeName: employee.name,
        serverUrl,
      });
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

  const handleInstallOnThisDevice = async (employee: Employee) => {
    try {
      const res = await api.post('/api/auth/setup-token', { employeeId: employee.id });
      const tokenData = res.data || res;
      const token = tokenData.token || tokenData.setupToken;
      if (!token) throw new Error('Server did not return a setup token');

      const serverUrl = await getPreferredActivationServerUrl();
      const payload = buildActivationPayload({
        setupToken: token,
        serverUrl,
        employeeName: employee.name,
      });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `teamtracker-activate-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setInstallPrompt({ employeeName: employee.name });
    } catch (err) {
      console.error('Error preparing install:', err);
      alert(err instanceof Error ? err.message : 'Failed to prepare install');
    }
  };

  return {
    employees,
    filtered,
    loading,
    error,
    loadEmployees,
    query,
    setQuery,
    showForm,
    editingEmployee,
    formData,
    setFormData,
    formError,
    openCreate,
    closeForm,
    handleSubmit,
    handleEdit,
    handleDelete,
    handleGenerateSetupToken,
    handleRevokeDevices,
    handleInstallOnThisDevice,
    setupToken,
    setSetupToken,
    installPrompt,
    setInstallPrompt,
    defaultCurrency,
    orgTimezone,
  };
}
