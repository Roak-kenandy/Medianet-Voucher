export function formatPackageLabel(value) {
  if (!value) return '—';
  return value;
}

export const REPORT_TYPES = [
  { value: 'sales_report', label: 'Sales Report' },
  { value: 'dealer_topup', label: 'Operator Top-up Report' },
  { value: 'client_summary', label: 'Client Summary' },
  { value: 'customer_summary', label: 'Customer Summary' },
  { value: 'accounts_by_period', label: 'Accounts by Period' },
  { value: 'package_breakdown', label: 'Package Breakdown' },
];
