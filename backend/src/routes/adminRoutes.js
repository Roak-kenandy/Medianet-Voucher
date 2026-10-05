import { Router } from 'express';
import { authenticate, ensureActiveAccount, requireStaffRole, requirePermission } from '../middleware/auth.js';
import { AppError, asyncHandler, success } from '../utils/errors.js';
import { validateIdParam } from '../utils/params.js';
import { hasPermission } from '../constants/permissions.js';
import { refreshServiceTypes, listServiceTypesPublic } from '../constants/serviceTags.js';
import {
  refreshAppSettings,
  getAppSettingsForStaff,
  updateAppSettings,
} from '../services/appSettingsService.js';
import {
  listServiceTypesForStaff,
  createServiceType,
  updateServiceType,
  listSalesModels,
  getSalesModelOrThrow,
  createSalesModel,
  updateSalesModel,
} from '../services/crmConfigService.js';
import {
  reportLimiter,
  staffDashboardLimiter,
  passwordChangeLimiter,
  limitConcurrentPerUser,
} from '../middleware/rateLimit.js';
import { getClientMeta } from '../services/auditService.js';
import { crmService } from '../services/crmService.js';
import {
  getAdminStats,
  listAdmins,
  createAdmin,
  updateAdminStatus,
  resetAdminPassword,
  changeOwnAdminPassword,
  listOperators,
  createOperator,
  updateOperatorStatus,
  updateOperator,
  updateOperatorPackages,
  getActivePackages,
} from '../services/adminService.js';
import {
  getOperatorWallet,
  adminAdjustWallet,
  adminOperatorTopup,
  adminAdjustTrialQuota,
  completeTopup,
  listAdminOperatorActivations,
  exportAdminOperatorActivations,
  operatorActivationsToCsv,
  listWalletTransactions,
  listCrmReconciliationItems,
} from '../services/walletService.js';
import { findUserById } from '../services/authService.js';
import {
  listPackageGroups,
  createPackageGroup,
  updatePackageGroup,
  deletePackageGroup,
} from '../services/packageGroupService.js';
import {
  listOperatorUsers,
  createOperatorUser,
  updateOperatorUser,
  resetOperatorUserPassword,
} from '../services/operatorUserService.js';
import {
  createOperatorApiKey,
  listOperatorApiKeys,
  revokeOperatorApiKey,
  getOperatorApiAccess,
  setOperatorApiAccess,
} from '../services/operatorApiKeyService.js';
import { getDeveloperDocs } from '../services/developerDocsService.js';
import {
  listPackages,
  createPackage,
  updatePackage,
  updatePackageStatus,
} from '../services/packageService.js';
import { generateReport, streamReportExport } from '../services/reportService.js';
import { runWithReportSlot } from '../utils/reportConcurrency.js';
import {
  listMarketingAds,
  createMarketingAd,
  updateMarketingAd,
  deleteMarketingAd,
} from '../services/marketingAdService.js';
import { marketingAdUpload } from '../middleware/uploadMarketingAd.js';
import { marketingAdPayloadFromForm, knowledgeDocumentPayloadFromForm } from '../validators/schemas.js';
import {
  listKnowledgeDocuments,
  createKnowledgeDocument,
  updateKnowledgeDocument,
  deleteKnowledgeDocument,
} from '../services/knowledgeDocumentService.js';
import { knowledgeDocumentUpload } from '../middleware/uploadKnowledgeDocument.js';
import {
  createAdminSchema,
  createOperatorSchema,
  createPackageSchema,
  updatePackageSchema,
  updateOperatorSchema,
  walletAdjustSchema,
  adminOperatorTopupSchema,
  reportQuerySchema,
  listQuerySchema,
  operatorActivationsQuerySchema,
  operatorActivationsExportSchema,
  toggleActiveBodySchema,
  operatorApiKeySchema,
  operatorApiAccessSchema,
  updateOperatorPackagesSchema,
  packageGroupSchema,
  trialQuotaAdjustSchema,
  crmCatalogQuerySchema,
  createServiceTypeSchema,
  updateServiceTypeSchema,
  salesModelSchema,
  appSettingsSchema,
  createOperatorUserSchema,
  updateOperatorUserSchema,
  resetOperatorUserPasswordSchema,
  resetAdminPasswordSchema,
  changeOwnPasswordSchema,
} from '../validators/schemas.js';

const router = Router();

router.use(authenticate, ensureActiveAccount, requireStaffRole(), refreshServiceTypes, refreshAppSettings);
router.param('id', validateIdParam);
router.param('transactionId', validateIdParam);
router.param('keyId', validateIdParam);
router.param('userId', validateIdParam);

router.get(
  '/packages',
  asyncHandler(async (req, res) => {
    const queryParams = listQuerySchema.parse(req.query);
    const result = await listPackages(queryParams);
    success(res, result);
  })
);

router.get(
  '/packages/active',
  asyncHandler(async (_req, res) => {
    const packages = await getActivePackages();
    success(res, {
      packages: packages.map((pkg) => ({
        id: pkg.id,
        value: pkg.id,
        label: pkg.name,
        name: pkg.name,
        serviceTag: pkg.service_tag || 'OTT',
        salesModelId: pkg.sales_model_id ?? null,
        salesModelName: pkg.sales_model_name || null,
        packageRole: pkg.package_role || 'standalone',
        upgradeFamily: pkg.upgrade_family || null,
        upgradeTier: pkg.upgrade_tier ?? null,
        priceAmount: Number(pkg.price_amount),
        currencyCode: pkg.currency_code,
      })),
    });
  })
);

router.get(
  '/packages/crm-recommendations',
  requirePermission('createPackage'),
  asyncHandler(async (req, res) => {
    const { serviceTag, salesModelId } = crmCatalogQuerySchema.parse(req.query);
    const salesModel = await getSalesModelOrThrow(salesModelId, { activeOnly: true });
    const recommendations = await crmService.fetchProductCatalog(serviceTag, salesModel.name);
    success(res, { recommendations, serviceTag, salesModel: { id: salesModel.id, name: salesModel.name } });
  })
);

router.post(
  '/packages',
  requirePermission('createPackage'),
  asyncHandler(async (req, res) => {
    const data = createPackageSchema.parse(req.body);
    const pkg = await createPackage(req.user.id, data, getClientMeta(req));
    success(res, pkg, 201);
  })
);

router.patch(
  '/packages/:id',
  requirePermission('createPackage'),
  asyncHandler(async (req, res) => {
    const packageId = parseInt(req.params.id, 10);
    const data = updatePackageSchema.parse(req.body);
    const pkg = await updatePackage(req.user.id, packageId, data, getClientMeta(req));
    success(res, pkg);
  })
);

router.patch(
  '/packages/:id/status',
  requirePermission('managePackageStatus'),
  asyncHandler(async (req, res) => {
    const packageId = parseInt(req.params.id, 10);
    const { isActive } = toggleActiveBodySchema.parse(req.body);
    const result = await updatePackageStatus(req.user.id, packageId, isActive, getClientMeta(req));
    success(res, result);
  })
);

/** Global settings: time zone, GST rate, TIN and currency. */
router.get(
  '/settings',
  requirePermission('manageCrmSettings'),
  asyncHandler(async (_req, res) => {
    success(res, await getAppSettingsForStaff());
  })
);

router.put(
  '/settings',
  requirePermission('manageCrmSettings'),
  asyncHandler(async (req, res) => {
    const data = appSettingsSchema.parse(req.body);
    success(res, await updateAppSettings(req.user.id, data, getClientMeta(req)));
  })
);

/**
 * Customer types and sales models. Every staff member can read the names (the operator and
 * package forms need them); the CRM ids and all changes need the CRM settings permission.
 */
router.get(
  '/service-types',
  asyncHandler(async (req, res) => {
    const serviceTypes = hasPermission(req.user.role, 'manageCrmSettings')
      ? await listServiceTypesForStaff()
      : listServiceTypesPublic();
    success(res, { serviceTypes });
  })
);

router.post(
  '/service-types',
  requirePermission('manageCrmSettings'),
  asyncHandler(async (req, res) => {
    const data = createServiceTypeSchema.parse(req.body);
    const serviceType = await createServiceType(req.user.id, data, getClientMeta(req));
    success(res, serviceType, 201);
  })
);

router.patch(
  '/service-types/:typeKey',
  requirePermission('manageCrmSettings'),
  asyncHandler(async (req, res) => {
    const typeKey = String(req.params.typeKey || '');
    if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(typeKey)) {
      throw new AppError('Invalid customer type', 400, 'VALIDATION_ERROR');
    }
    const data = updateServiceTypeSchema.parse(req.body);
    const serviceType = await updateServiceType(req.user.id, typeKey, data, getClientMeta(req));
    success(res, serviceType);
  })
);

router.get(
  '/sales-models',
  asyncHandler(async (_req, res) => {
    const salesModels = await listSalesModels();
    success(res, { salesModels });
  })
);

router.post(
  '/sales-models',
  requirePermission('manageCrmSettings'),
  asyncHandler(async (req, res) => {
    const data = salesModelSchema.parse(req.body);
    const salesModel = await createSalesModel(req.user.id, data, getClientMeta(req));
    success(res, salesModel, 201);
  })
);

router.patch(
  '/sales-models/:id',
  requirePermission('manageCrmSettings'),
  asyncHandler(async (req, res) => {
    const salesModelId = parseInt(req.params.id, 10);
    const data = salesModelSchema.parse(req.body);
    const salesModel = await updateSalesModel(req.user.id, salesModelId, data, getClientMeta(req));
    success(res, salesModel);
  })
);

/**
 * Package groups: shared sets of packages. Changing a group changes every operator in it,
 * so editing needs the same permission as creating packages.
 */
router.get(
  '/package-groups',
  asyncHandler(async (_req, res) => {
    const groups = await listPackageGroups();
    success(res, { groups });
  })
);

router.post(
  '/package-groups',
  requirePermission('createPackage'),
  asyncHandler(async (req, res) => {
    const data = packageGroupSchema.parse(req.body);
    const group = await createPackageGroup(req.user.id, data, getClientMeta(req));
    success(res, group, 201);
  })
);

router.patch(
  '/package-groups/:id',
  requirePermission('createPackage'),
  asyncHandler(async (req, res) => {
    const groupId = parseInt(req.params.id, 10);
    const data = packageGroupSchema.parse(req.body);
    const group = await updatePackageGroup(req.user.id, groupId, data, getClientMeta(req));
    success(res, group);
  })
);

router.delete(
  '/package-groups/:id',
  requirePermission('createPackage'),
  asyncHandler(async (req, res) => {
    const groupId = parseInt(req.params.id, 10);
    const result = await deletePackageGroup(req.user.id, groupId, getClientMeta(req));
    success(res, result);
  })
);

router.get(
  '/stats',
  requirePermission('viewReports'),
  staffDashboardLimiter,
  limitConcurrentPerUser(2, 'staff-stats'),
  asyncHandler(async (_req, res) => {
    const stats = await getAdminStats();
    success(res, stats);
  })
);

router.get(
  '/admins',
  asyncHandler(async (req, res) => {
    const queryParams = listQuerySchema.parse(req.query);
    const result = await listAdmins(queryParams);
    success(res, result);
  })
);

router.post(
  '/admins',
  requirePermission('createAdmin'),
  asyncHandler(async (req, res) => {
    const data = createAdminSchema.parse(req.body);
    const admin = await createAdmin(req.user.id, req.user.role, data, getClientMeta(req));
    success(res, admin, 201);
  })
);

router.patch(
  '/admins/:id/status',
  requirePermission('manageAdminStatus'),
  asyncHandler(async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    const { isActive } = toggleActiveBodySchema.parse(req.body);
    const result = await updateAdminStatus(req.user.id, targetId, isActive, getClientMeta(req));
    success(res, result);
  })
);

/** Any staff member changes their own password; every session of theirs ends afterwards. */
router.post(
  '/me/password',
  passwordChangeLimiter,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changeOwnPasswordSchema.parse(req.body);
    const result = await changeOwnAdminPassword(
      req.user.id,
      currentPassword,
      newPassword,
      getClientMeta(req)
    );
    success(res, result);
  })
);

router.patch(
  '/admins/:id/password',
  requirePermission('createAdmin'),
  passwordChangeLimiter,
  asyncHandler(async (req, res) => {
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.user.id) {
      throw new AppError('Use "Change my password" for your own account', 400, 'VALIDATION_ERROR');
    }
    const { password } = resetAdminPasswordSchema.parse(req.body);
    const result = await resetAdminPassword(req.user.id, targetId, password, getClientMeta(req));
    success(res, result);
  })
);

router.get(
  '/operators',
  asyncHandler(async (req, res) => {
    const queryParams = listQuerySchema.parse(req.query);
    const result = await listOperators(queryParams);
    success(res, result);
  })
);

router.post(
  '/operators',
  requirePermission('manageOperators'),
  asyncHandler(async (req, res) => {
    const data = createOperatorSchema.parse(req.body);
    const operator = await createOperator(req.user.id, data, getClientMeta(req));
    success(res, operator, 201);
  })
);

router.patch(
  '/operators/:id/status',
  requirePermission('manageOperators'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const { isActive } = toggleActiveBodySchema.parse(req.body);
    const result = await updateOperatorStatus(req.user.id, operatorId, isActive, getClientMeta(req));
    success(res, result);
  })
);

router.patch(
  '/operators/:id/packages',
  requirePermission('manageOperators'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const assignment = updateOperatorPackagesSchema.parse(req.body);
    const result = await updateOperatorPackages(req.user.id, operatorId, assignment, getClientMeta(req));
    success(res, result);
  })
);

/** Portal users of one operator: view, add, edit, activate or deactivate, reset password. */
router.get(
  '/operators/:id/users',
  requirePermission('manageOperators'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const result = await listOperatorUsers(operatorId);
    success(res, result);
  })
);

router.post(
  '/operators/:id/users',
  requirePermission('manageOperators'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const data = createOperatorUserSchema.parse(req.body);
    const user = await createOperatorUser(req.user.id, operatorId, data, getClientMeta(req));
    success(res, user, 201);
  })
);

router.patch(
  '/operators/:id/users/:userId',
  requirePermission('manageOperators'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const userId = parseInt(req.params.userId, 10);
    const data = updateOperatorUserSchema.parse(req.body);
    const user = await updateOperatorUser(req.user.id, operatorId, userId, data, getClientMeta(req));
    success(res, user);
  })
);

router.patch(
  '/operators/:id/users/:userId/password',
  requirePermission('manageOperators'),
  passwordChangeLimiter,
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const userId = parseInt(req.params.userId, 10);
    const { password } = resetOperatorUserPasswordSchema.parse(req.body);
    const result = await resetOperatorUserPassword(
      req.user.id,
      operatorId,
      userId,
      password,
      getClientMeta(req)
    );
    success(res, result);
  })
);

/** API keys for the operator API. The full key is returned only by the create call. */
router.get(
  '/operators/:id/api-keys',
  requirePermission('manageOperators'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const [apiKeys, apiAccessEnabled] = await Promise.all([
      listOperatorApiKeys(operatorId),
      getOperatorApiAccess(operatorId),
    ]);
    success(res, { apiKeys, apiAccessEnabled });
  })
);

/** Switches the operator API (keys and developer documentation) on or off for an operator. */
router.put(
  '/operators/:id/api-access',
  requirePermission('manageOperators'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const { enabled } = operatorApiAccessSchema.parse(req.body || {});
    success(res, await setOperatorApiAccess(req.user.id, operatorId, enabled, getClientMeta(req)));
  })
);

/** Operator API documentation, for any signed-in staff member. */
router.get(
  '/developer-docs',
  asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    success(res, await getDeveloperDocs());
  })
);

router.post(
  '/operators/:id/api-keys',
  requirePermission('manageOperators'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const payload = operatorApiKeySchema.parse(req.body || {});
    const apiKey = await createOperatorApiKey(req.user.id, operatorId, payload, getClientMeta(req));
    res.setHeader('Cache-Control', 'no-store');
    success(res, apiKey, 201);
  })
);

router.delete(
  '/operators/:id/api-keys/:keyId',
  requirePermission('manageOperators'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const keyId = parseInt(req.params.keyId, 10);
    const result = await revokeOperatorApiKey(req.user.id, operatorId, keyId, getClientMeta(req));
    success(res, result);
  })
);

router.get(
  '/operators/:id/wallet',
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const wallet = await getOperatorWallet(operatorId);
    success(res, wallet);
  })
);

router.get(
  '/operators/:id/wallet/transactions',
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const queryParams = listQuerySchema.parse(req.query);
    const result = await listWalletTransactions(operatorId, queryParams);
    success(res, result);
  })
);

router.post(
  '/operators/:id/wallet/adjust',
  requirePermission('adjustWallet'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const { amount, description } = walletAdjustSchema.parse(req.body);
    const result = await adminAdjustWallet(req.user.id, operatorId, amount, description, getClientMeta(req));
    success(res, result);
  })
);

/** Increase, deduct or revoke an operator's free account quota (same permission as granting it). */
router.post(
  '/operators/:id/trial-quota',
  requirePermission('adjustWallet'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const payload = trialQuotaAdjustSchema.parse(req.body);
    const result = await adminAdjustTrialQuota(req.user.id, operatorId, payload, getClientMeta(req));
    success(res, result);
  })
);

router.get(
  '/operator-activations',
  requirePermission('adjustWallet'),
  asyncHandler(async (req, res) => {
    const queryParams = operatorActivationsQuerySchema.parse(req.query);
    const result = await listAdminOperatorActivations(queryParams);
    success(res, result);
  })
);

router.get(
  '/operator-activations/export',
  requirePermission('adjustWallet'),
  reportLimiter,
  asyncHandler(async (req, res) => {
    const filters = operatorActivationsExportSchema.parse(req.query);
    await runWithReportSlot(req, async () => {
      const report = await exportAdminOperatorActivations(filters);
      const csv = operatorActivationsToCsv(report);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="operator-wallet-activations.csv"'
      );
      res.send(csv);
    });
  })
);

router.post(
  '/operators/:id/wallet/topup',
  requirePermission('adjustWallet'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const payload = adminOperatorTopupSchema.parse(req.body);
    const staff = await findUserById('admin', req.user.id);
    const result = await adminOperatorTopup(
      req.user.id,
      operatorId,
      payload,
      getClientMeta(req),
      { name: staff?.name, email: staff?.email }
    );
    success(res, result, 201);
  })
);

router.post(
  '/operators/:id/wallet/topups/:transactionId/complete',
  requirePermission('completeTopup'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const transactionId = parseInt(req.params.transactionId, 10);
    const paymentRef = req.body?.paymentRef ? String(req.body.paymentRef).trim().slice(0, 255) : null;
    const result = await completeTopup(transactionId, paymentRef, getClientMeta(req), {
      type: 'admin',
      id: req.user.id,
    }, {
      expectedOperatorId: operatorId,
    });
    success(res, result);
  })
);

router.patch(
  '/operators/:id',
  requirePermission('manageOperators'),
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const data = updateOperatorSchema.parse(req.body);
    const result = await updateOperator(req.user.id, operatorId, data, getClientMeta(req));
    success(res, result);
  })
);

router.get(
  '/marketing-ads',
  requirePermission('manageMarketingAds'),
  asyncHandler(async (_req, res) => {
    const ads = await listMarketingAds();
    success(res, { ads });
  })
);

router.post(
  '/marketing-ads',
  requirePermission('manageMarketingAds'),
  marketingAdUpload.single('image'),
  asyncHandler(async (req, res) => {
    const payload = marketingAdPayloadFromForm(req.body);
    const ad = await createMarketingAd(req.user.id, payload, req.file?.filename);
    success(res, ad, 201);
  })
);

router.put(
  '/marketing-ads/:id',
  requirePermission('manageMarketingAds'),
  marketingAdUpload.single('image'),
  asyncHandler(async (req, res) => {
    const adId = parseInt(req.params.id, 10);
    const payload = marketingAdPayloadFromForm(req.body);
    const ad = await updateMarketingAd(adId, payload, req.file?.filename || null);
    success(res, ad);
  })
);

router.delete(
  '/marketing-ads/:id',
  requirePermission('manageMarketingAds'),
  asyncHandler(async (req, res) => {
    const adId = parseInt(req.params.id, 10);
    const result = await deleteMarketingAd(adId);
    success(res, result);
  })
);

router.get(
  '/knowledge-documents',
  requirePermission('manageKnowledgeBase'),
  asyncHandler(async (_req, res) => {
    const documents = await listKnowledgeDocuments();
    success(res, { documents });
  })
);

router.post(
  '/knowledge-documents',
  requirePermission('manageKnowledgeBase'),
  knowledgeDocumentUpload.single('file'),
  asyncHandler(async (req, res) => {
    const payload = knowledgeDocumentPayloadFromForm(req.body);
    const doc = await createKnowledgeDocument(req.user.id, payload, req.file);
    success(res, doc, 201);
  })
);

router.put(
  '/knowledge-documents/:id',
  requirePermission('manageKnowledgeBase'),
  knowledgeDocumentUpload.single('file'),
  asyncHandler(async (req, res) => {
    const docId = parseInt(req.params.id, 10);
    const payload = knowledgeDocumentPayloadFromForm(req.body);
    const doc = await updateKnowledgeDocument(docId, payload, req.file || null);
    success(res, doc);
  })
);

router.delete(
  '/knowledge-documents/:id',
  requirePermission('manageKnowledgeBase'),
  asyncHandler(async (req, res) => {
    const docId = parseInt(req.params.id, 10);
    const result = await deleteKnowledgeDocument(docId);
    success(res, result);
  })
);

router.get(
  '/reports',
  requirePermission('viewReports'),
  reportLimiter,
  asyncHandler(async (req, res) => {
    const filters = reportQuerySchema.parse(req.query);
    await runWithReportSlot(req, async () => {
      const report = await generateReport(filters);
      success(res, report);
    });
  })
);

router.get(
  '/reports/export',
  requirePermission('viewReports'),
  reportLimiter,
  asyncHandler(async (req, res) => {
    const filters = reportQuerySchema.parse(req.query);
    await runWithReportSlot(req, async () => {
      await streamReportExport(res, filters);
    });
  })
);

/** Charges held because a CRM payment may have posted without the activation completing. */
router.get(
  '/crm-reconciliation',
  requirePermission('adjustWallet'),
  asyncHandler(async (req, res) => {
    const queryParams = listQuerySchema.parse(req.query);
    const result = await listCrmReconciliationItems(queryParams);
    success(res, result);
  })
);

export default router;
