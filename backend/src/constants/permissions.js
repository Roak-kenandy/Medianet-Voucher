export const STAFF_ROLES = ['admin', 'sales', 'finance'];

export const ROLE_PERMISSIONS = {
  admin: {
    createAdmin: true,
    manageAdminStatus: true,
    createPackage: true,
    managePackageStatus: true,
    manageOperators: true,
    adjustWallet: true,
    completeTopup: true,
    viewReports: true,
    manageMarketingAds: true,
    manageKnowledgeBase: true,
    manageCrmSettings: true,
  },
  sales: {
    createAdmin: false,
    manageAdminStatus: false,
    createPackage: true,
    managePackageStatus: true,
    manageOperators: true,
    adjustWallet: true,
    completeTopup: false,
    viewReports: true,
    manageMarketingAds: true,
    manageKnowledgeBase: true,
    manageCrmSettings: false,
  },
  finance: {
    createAdmin: false,
    manageAdminStatus: false,
    createPackage: false,
    managePackageStatus: false,
    manageOperators: false,
    adjustWallet: true,
    completeTopup: true,
    viewReports: true,
    manageMarketingAds: false,
    manageKnowledgeBase: false,
    manageCrmSettings: false,
  },
};

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

export function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[role]?.[permission]);
}
