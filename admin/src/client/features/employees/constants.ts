import type { EmployeeFormData } from './types';

export { COMMON_TIMEZONES } from '@/lib/timezones';

export const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

export const emptyFormData = (defaultCurrency: string): EmployeeFormData => ({
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
  jobRoleType: 'auto',
});
