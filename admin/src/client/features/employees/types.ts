import type { Employee } from '../../../../../shared-types';

export interface EmployeeFormData {
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

export interface SetupTokenState {
  token: string;
  employeeName: string;
  /** Preferred LAN-reachable server URL for QR / activation. */
  serverUrl: string;
}

export interface InstallPromptState {
  employeeName: string;
}

export interface UseEmployeesReturn {
  // list
  employees: Employee[];
  filtered: Employee[];
  loading: boolean;
  error: string | null;
  loadEmployees: () => Promise<void>;

  // search
  query: string;
  setQuery: (q: string) => void;

  // form
  showForm: boolean;
  editingEmployee: Employee | null;
  formData: EmployeeFormData;
  setFormData: React.Dispatch<React.SetStateAction<EmployeeFormData>>;
  formError: string | null;
  openCreate: () => void;
  closeForm: () => void;

  // CRUD
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  handleEdit: (employee: Employee) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;

  // setup actions
  handleGenerateSetupToken: (employee: Employee) => Promise<void>;
  handleRevokeDevices: (employee: Employee) => Promise<void>;
  handleInstallOnThisDevice: (employee: Employee) => Promise<void>;
  setupToken: SetupTokenState | null;
  setSetupToken: React.Dispatch<React.SetStateAction<SetupTokenState | null>>;
  installPrompt: InstallPromptState | null;
  setInstallPrompt: React.Dispatch<React.SetStateAction<InstallPromptState | null>>;

  // org
  defaultCurrency: string;
  orgTimezone: string;
}
