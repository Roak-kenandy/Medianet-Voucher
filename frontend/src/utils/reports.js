import { formatPackageLabel } from '../constants/packages';

const COLUMN_LABELS = {
  operatorId: 'Operator ID',
  clientName: 'Client Name',
  packageType: 'Package',
  email: 'Email',
  accountQuota: 'Account Quota',
  accountsCreated: 'Accounts Created',
  isActive: 'Active',
  recordsInPeriod: 'Records In Period',
  createdInPeriod: 'Created In Period',
  pendingInPeriod: 'Pending In Period',
  failedInPeriod: 'Failed In Period',
  date: 'Date',
  totalAccounts: 'Total Accounts',
  created: 'Created',
  failed: 'Failed',
  operatorCount: 'Operators',
  createdAccounts: 'Created Accounts',
  lifetimeAccountsCreated: 'Lifetime Created',
  fullName: 'Full Name',
  phoneNumber: 'Phone Number',
  status: 'Status',
  createdAt: 'Created At',
};

const SUMMARY_LABELS = {
  totalClients: 'Total Clients',
  totalAccountsCreated: 'Total Accounts Created',
  totalInPeriod: 'Total In Period',
  clientName: 'Client',
  packageType: 'Package',
  email: 'Email',
  accountQuota: 'Account Quota',
  accountsCreated: 'Accounts Used',
  remainingQuota: 'Remaining Quota',
  recordsInPeriod: 'Records In Period',
  createdInPeriod: 'Created In Period',
  pendingInPeriod: 'Pending In Period',
  failedInPeriod: 'Failed In Period',
};

export function formatColumnLabel(key) {
  return COLUMN_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

export function formatSummaryLabel(key) {
  return SUMMARY_LABELS[key] || formatColumnLabel(key);
}

export function formatCellValue(key, value) {
  if (key === 'isActive') return value ? 'Yes' : 'No';
  if (key === 'packageType') return formatPackageLabel(value);
  if (key === 'createdAt' && value) {
    return new Date(value).toLocaleString();
  }
  if (key === 'date' && value) {
    return new Date(value).toLocaleDateString();
  }
  return String(value ?? '');
}

export function downloadCsv(content, filename) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
