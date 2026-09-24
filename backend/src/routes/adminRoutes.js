import { Router } from 'express';
import { authenticate, ensureActiveAccount, requireStaffRole, requirePermission } from '../middleware/auth.js';
import { asyncHandler, success } from '../utils/errors.js';
import { getClientMeta } from '../services/auditService.js';
import { crmService } from '../services/crmService.js';
import {
  getAdminStats,
  listAdmins,
  createAdmin,
  updateAdminStatus,
  listOperators,
  createOperator,
  updateOperatorStatus,
  updateOperator,
  getActivePackages,
} from '../services/adminService.js';
import {
  getOperatorWallet,
  adminAdjustWallet,
  adminOperatorTopup,
  completeTopup,
  listAdminOperatorActivations,
  exportAdminOperatorActivations,
  operatorActivationsToCsv,
  listWalletTransactions,
} from '../services/walletService.js';
import { findUserById } from '../services/authService.js';
import {
  listPackages,
  createPackage,
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
  updateOperatorSchema,
  walletAdjustSchema,
  adminOperatorTopupSchema,
  reportQuerySchema,
  listQuerySchema,
  operatorActivationsQuerySchema,
  operatorActivationsExportSchema,
  toggleActiveBodySchema,
} from '../validators/schemas.js';

const router = Router();

router.use(authenticate, ensureActiveAccount, requireStaffRole());

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
    const serviceTag = req.query.serviceTag === 'MEDIANET_TV' ? 'MEDIANET_TV' : 'OTT';
    const recommendations = await crmService.fetchProductCatalog(serviceTag);
    success(res, { recommendations, serviceTag });
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
  '/packages/:id/status',
  requirePermission('managePackageStatus'),
  asyncHandler(async (req, res) => {
    const packageId = parseInt(req.params.id, 10);
    const { isActive } = toggleActiveBodySchema.parse(req.body);
    const result = await updatePackageStatus(req.user.id, packageId, isActive, getClientMeta(req));
    success(res, result);
  })
);

router.get(
  '/stats',
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
  asyncHandler(async (req, res) => {
    const filters = operatorActivationsExportSchema.parse(req.query);
    const report = await exportAdminOperatorActivations(filters);
    const csv = operatorActivationsToCsv(report);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="operator-wallet-activations.csv"'
    );
    res.send(csv);
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
    const paymentRef = req.body.paymentRef ? String(req.body.paymentRef) : null;
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
  asyncHandler(async (req, res) => {
    await runWithReportSlot(async () => {
      const filters = reportQuerySchema.parse(req.query);
      const report = await generateReport(filters);
      success(res, report);
    });
  })
);

router.get(
  '/reports/export',
  requirePermission('viewReports'),
  asyncHandler(async (req, res) => {
    await runWithReportSlot(async () => {
      const filters = reportQuerySchema.parse(req.query);
      await streamReportExport(res, filters);
    });
  })
);

export default router;
