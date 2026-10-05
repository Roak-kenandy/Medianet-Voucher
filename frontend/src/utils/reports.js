import { formatPackageLabel } from '../constants/packages';
import { getServiceTagShortLabel } from '../constants/serviceTags';
import { formatMoney } from './money';
import { formatDateTime, formatDate } from '../constants/appSettings';

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
  customerName: 'Customer Name',
  phoneNumber: 'Phone Number',
  serviceTag: 'Service',
  packages: 'Packages',
  activatedAt: 'Activated Date',
  operatorName: 'Operator',
  accountId: 'Account ID',
  externalRef: 'External Ref',
  errorMessage: 'Error',
  amountCharged: 'Amount Charged',
  status: 'Status',
  createdAt: 'Created At',
  time: 'Date & Time',
  reference: 'Reference',
  operator: 'Operator',
  operatorEmail: 'Operator Email',
  amountPaid: 'Amount Paid',
  gstAmount: 'GST',
  afterGst: 'After GST',
  commission: 'Commission',
  credited: 'Credited',
  gstRatePercent: 'GST Rate %',
  processedBy: 'Processed By',
  paymentRef: 'Payment Reference',
  source: 'Source',
  onlineTopups: 'Online Top-ups',
  manualTopups: 'Manual Top-ups',
  walletSpend: 'Wallet Spend',
  customerActions: 'Customer Actions',
};

const SUMMARY_LABELS = {
  totalClients: 'Total Clients',
  totalAccountsCreated: 'Total Accounts Created',
  totalInPeriod: 'Total In Period',
  totalCustomers: 'Total Customers',
  createdCount: 'Created',
  pendingCount: 'Pending / Processing',
  failedCount: 'Failed',
  uniqueOperators: 'Operators',
  clientName: 'Client',
  packageType: 'Package',
  email: 'Email',
  walletBalance: 'Wallet Balance',
  currencyCode: 'Currency',
  accountsCreated: 'Accounts Created',
  spentInPeriod: 'Spent In Period',
  recordsInPeriod: 'Records In Period',
  createdInPeriod: 'Created In Period',
  pendingInPeriod: 'Pending In Period',
  failedInPeriod: 'Failed In Period',
  totalRecords: 'Transactions',
  totalAmountPaid: 'Total Paid',
  totalAfterGst: 'Total After GST',
  totalGstAmount: 'Total GST',
  totalCommission: 'Total Commission',
  totalCredited: 'Total Credited',
  uniqueOperators: 'Operators',
  gstRatePercent: 'GST Rate %',
  operatorsWithActivity: 'Operators With Activity',
  totalOnlineTopups: 'Online Top-ups',
  totalManualTopups: 'Manual Top-ups',
  totalWalletSpend: 'Wallet Spend',
  totalCustomerActions: 'Customer Actions',
  totalAccountsCreated: 'Accounts Created',
  totalAmountCharged: 'Amount Charged',
  totalGstAmount: 'Total GST',
  totalCommission: 'Total Commission',
  date: 'Date',
  user: 'User',
  dealer: 'Dealer',
  account: 'Account',
  area: 'Area',
  customerName: 'Customer name',
  atoll: 'Atoll',
  island: 'Island',
  ward: 'Ward',
  street: 'Street',
  address: 'Address',
  paymentMethod: 'Payment method',
  action: 'Action',
  amount: 'Amount',
  gst: 'GST',
  total: 'Total',
  receipt: '#Receipt',
  totalPayments: 'Payments',
  addCount: 'Added',
  deductCount: 'Deducted',
  netAmount: 'Amount ex GST',
  netGst: 'GST',
  netTotal: 'Net total',
};

export function formatColumnLabel(key) {
  return COLUMN_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

export function formatSummaryLabel(key) {
  return SUMMARY_LABELS[key] || formatColumnLabel(key);
}

const MONEY_SUMMARY_KEYS = new Set([
  'walletBalance',
  'spentInPeriod',
  'totalAmountPaid',
  'totalAfterGst',
  'totalGstAmount',
  'totalCommission',
  'totalCredited',
  'totalWalletSpend',
  'totalAmountCharged',
  'netAmount',
  'netGst',
  'netTotal',
]);

const TEXT_SUMMARY_KEYS = new Set(['clientName', 'packageType', 'email', 'currencyCode']);

export function isTextSummaryKey(key) {
  return TEXT_SUMMARY_KEYS.has(key);
}

export function formatSummaryValue(key, value, currencyCode = 'MVR') {
  if (key === 'packageType') return formatPackageLabel(value);
  if (MONEY_SUMMARY_KEYS.has(key)) return formatMoney(value, currencyCode);
  if (key === 'gstRatePercent') return value != null ? `${value}%` : '—';
  return String(value ?? '');
}

const MONEY_COLUMN_KEYS = new Set([
  'amountPaid',
  'afterGst',
  'credited',
  'gstAmount',
  'commission',
  'amountCharged',
  'walletSpend',
  'amount',
  'gst',
  'total',
]);

export function formatCellValue(key, value, currencyCode = 'MVR') {
  if (key === 'isActive') return value ? 'Yes' : 'No';
  if (key === 'packageType') return formatPackageLabel(value);
  if (MONEY_COLUMN_KEYS.has(key)) return formatMoney(value, currencyCode);
  if (key === 'gstRatePercent') return value != null ? `${value}%` : '—';
  if ((key === 'createdAt' || key === 'activatedAt') && value) {
    return formatDateTime(value);
  }
  if (key === 'serviceTag' && value) {
    return getServiceTagShortLabel(String(value));
  }
  if (key === 'date' && value) {
    return formatDate(value);
  }
  return String(value ?? '');
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(content, filename) {
  downloadBlob(new Blob([content], { type: 'text/csv' }), filename);
}

/** Report types that load one page at a time from the API (large datasets). */
export const SERVER_PAGINATED_REPORT_TYPES = ['dealer_topup', 'customer_summary'];
