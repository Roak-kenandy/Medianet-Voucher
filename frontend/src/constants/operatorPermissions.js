export const OPERATOR_PORTAL_ROLE_LABELS = {
  supervisor: 'Supervisor',
  user: 'Normal user',
};

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

export const OPERATOR_ROUTE_PERMISSIONS = {
  '/operator': 'dashboard',
  '/operator/wallet': 'wallet',
  '/operator/wallet/payment/return': 'wallet',
  '/operator/create': 'createAccount',
  '/operator/customers': 'customers',
  '/operator/bulk': 'bulkUpload',
  '/operator/accounts': 'accounts',
  '/operator/transactions': 'transactions',
  '/operator/reports': 'reports',
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

  const parsed =
    rawPermissions && typeof rawPermissions === 'object' && !Array.isArray(rawPermissions)
      ? rawPermissions
      : {};

  const merged = defaultOperatorPermissions(false);
  for (const key of OPERATOR_PERMISSION_KEYS) {
    if (typeof parsed[key] === 'boolean') {
      merged[key] = parsed[key];
    }
  }
  return merged;
}

export function operatorHasPermission(user, permission) {
  if (!user || user.role !== 'operator') return false;
  const portalRole = user.operatorPortalRole || 'supervisor';
  if (portalRole === 'supervisor') return true;
  const permissions = parseOperatorPermissions(portalRole, user.operatorPermissions);
  return Boolean(permissions[permission]);
}

export function getOperatorHomePath(user) {
  const order = [
    ['/operator', 'dashboard'],
    ['/operator/wallet', 'wallet'],
    ['/operator/create', 'createAccount'],
    ['/operator/customers', 'customers'],
    ['/operator/accounts', 'accounts'],
  ];
  for (const [path, permission] of order) {
    if (operatorHasPermission(user, permission)) return path;
  }
  return '/operator/settings';
}

export function permissionForOperatorPath(pathname) {
  if (pathname.startsWith('/operator/help') || pathname.startsWith('/operator/settings')) {
    return null;
  }
  const entries = Object.entries(OPERATOR_ROUTE_PERMISSIONS).sort(
    (a, b) => b[0].length - a[0].length
  );
  for (const [routePrefix, permission] of entries) {
    if (pathname === routePrefix || pathname.startsWith(`${routePrefix}/`)) {
      return permission;
    }
  }
  return 'dashboard';
}
