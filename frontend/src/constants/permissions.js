export const STAFF_ROLES = ['admin', 'sales', 'finance'];

export const ROLE_LABELS = {
  admin: 'Admin',
  sales: 'Sales',
  finance: 'Finance',
  operator: 'Operator',
};

export const ROLE_PERMISSIONS = {
  admin: {
    createAdmin: true,
    manageAdminStatus: true,
    createPackage: true,
    managePackageStatus: true,
  },
  sales: {
    createAdmin: false,
    manageAdminStatus: true,
    createPackage: true,
    managePackageStatus: true,
  },
  finance: {
    createAdmin: true,
    manageAdminStatus: true,
    createPackage: false,
    managePackageStatus: false,
  },
};

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

export function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[role]?.[permission]);
}

export function getStaffHomePath() {
  return '/admin';
}

export function getHomePathForRole(role) {
  if (isStaffRole(role)) return getStaffHomePath();
  if (role === 'operator') return '/operator';
  return '/login';
}
