export const STAFF_ROLES = ['admin', 'sales', 'finance', 'front_office'];

export const ROLE_PERMISSIONS = {
  admin: {
    createAdmin: true,
    changeStaffRole: true,
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
    viewStaff: true,
    viewDeveloperDocs: true,
  },
  sales: {
    createAdmin: false,
    changeStaffRole: false,
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
    viewStaff: true,
    viewDeveloperDocs: true,
  },
  finance: {
    createAdmin: false,
    changeStaffRole: false,
    manageAdminStatus: false,
    createPackage: false,
    managePackageStatus: false,
    manageOperators: true,
    adjustWallet: true,
    completeTopup: true,
    viewReports: true,
    manageMarketingAds: false,
    manageKnowledgeBase: false,
    manageCrmSettings: false,
    viewStaff: true,
    viewDeveloperDocs: true,
  },
  // Counter staff: dashboard, operator wallet top-ups (activate / adjust) and reports only.
  front_office: {
    createAdmin: false,
    changeStaffRole: false,
    manageAdminStatus: false,
    createPackage: false,
    managePackageStatus: false,
    manageOperators: false,
    adjustWallet: true,
    completeTopup: false,
    viewReports: true,
    manageMarketingAds: false,
    manageKnowledgeBase: false,
    manageCrmSettings: false,
    viewStaff: false,
    viewDeveloperDocs: false,
  },
};

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

export function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[role]?.[permission]);
}
