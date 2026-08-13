export const DEFAULT_PACKAGE = 'OTT ENTERTAINMENT (1y)';

export const PACKAGE_TYPES = [
  { value: DEFAULT_PACKAGE, label: DEFAULT_PACKAGE },
];

export function formatPackageLabel(value) {
  if (!value) return DEFAULT_PACKAGE;
  return value;
}

export const REPORT_TYPES = [
  { value: 'client_summary', label: 'Client Summary' },
  { value: 'accounts_by_period', label: 'Accounts by Period' },
  { value: 'package_breakdown', label: 'Package Breakdown' },
];
