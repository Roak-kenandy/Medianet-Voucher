import { getOperatorHomePath } from './operatorPermissions.js';

export const STAFF_ROLES = ['admin', 'sales', 'finance', 'front_office'];

export const ROLE_LABELS = {
  admin: 'Admin',
  sales: 'Sales',
  finance: 'Finance',
  front_office: 'Front Office',
  operator: 'Operator',
};

/** Page access shared by the back-office roles (everything except Front Office). */
const BACK_OFFICE_PAGES = {
  viewOperators: true,
  viewPackages: true,
  viewStaff: true,
  viewDeveloperDocs: true,
  viewReports: true,
};

export const ROLE_PERMISSIONS = {
  admin: {
    ...BACK_OFFICE_PAGES,
    changeStaffRole: true,
    createAdmin: true,
    manageAdminStatus: true,
    createPackage: true,
    managePackageStatus: true,
    manageOperators: true,
    adjustWallet: true,
    manageMarketingAds: true,
    manageKnowledgeBase: true,
    manageCrmSettings: true,
  },
  sales: {
    ...BACK_OFFICE_PAGES,
    changeStaffRole: false,
    createAdmin: false,
    manageAdminStatus: true,
    createPackage: true,
    managePackageStatus: true,
    manageOperators: true,
    adjustWallet: true,
    manageMarketingAds: true,
    manageKnowledgeBase: true,
    manageCrmSettings: false,
  },
  finance: {
    ...BACK_OFFICE_PAGES,
    changeStaffRole: false,
    createAdmin: true,
    manageAdminStatus: true,
    createPackage: false,
    managePackageStatus: false,
    manageOperators: true,
    adjustWallet: true,
    manageMarketingAds: false,
    manageKnowledgeBase: false,
    manageCrmSettings: false,
  },
  front_office: {
    viewReports: true,
    adjustWallet: true,
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

export function getHomePathForUser(user) {
  if (!user?.role) return '/login';
  if (user.role === 'operator') return getOperatorHomePath(user);
  return getHomePathForRole(user.role);
}
