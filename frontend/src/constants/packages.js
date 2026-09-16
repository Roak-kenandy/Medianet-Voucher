export function formatPackageLabel(value) {
  if (!value) return '—';
  return value;
}

export const REPORT_TYPES = [
  { value: 'dealer_topup', label: 'Operator Top-up Report' },
  { value: 'client_summary', label: 'Client Summary' },
  { value: 'accounts_by_period', label: 'Accounts by Period' },
  { value: 'package_breakdown', label: 'Package Breakdown' },
];
