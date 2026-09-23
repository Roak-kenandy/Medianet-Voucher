export const OPERATOR_PORTAL_ROLES = ['supervisor', 'user'];

export const OPERATOR_PERMISSION_KEYS = [
  'dashboard',
  'wallet',
  'createAccount',
  'customers',
  'bulkUpload',
  'accounts',
  'transactions',
  'reports',
];

export const OPERATOR_PERMISSION_LABELS = {
  dashboard: 'Dashboard',
  wallet: 'Wallet',
  createAccount: 'Create account',
  customers: 'Topup & subscribe',
  bulkUpload: 'Bulk upload',
  accounts: 'Customer history',
  transactions: 'Transaction reports',
  reports: 'Account reports',
};

export function defaultOperatorPermissions(enabled = false) {
  return Object.fromEntries(
    OPERATOR_PERMISSION_KEYS.map((key) => [key, Boolean(enabled)])
  );
}

export function parseOperatorPermissions(portalRole, rawPermissions) {
  if (portalRole === 'supervisor' || !portalRole) {
    return defaultOperatorPermissions(true);
  }

  let parsed = rawPermissions;
  if (typeof rawPermissions === 'string') {
    try {
      parsed = JSON.parse(rawPermissions);
    } catch {
      parsed = {};
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    parsed = {};
  }

  const merged = defaultOperatorPermissions(false);
  for (const key of OPERATOR_PERMISSION_KEYS) {
    if (typeof parsed[key] === 'boolean') {
      merged[key] = parsed[key];
    }
  }
  return merged;
}

export function operatorHasPermission(portalRole, permissions, permission) {
  if (portalRole === 'supervisor') return true;
  return Boolean(permissions?.[permission]);
}

export function normalizePortalRole(value) {
  return value === 'user' ? 'user' : 'supervisor';
}
