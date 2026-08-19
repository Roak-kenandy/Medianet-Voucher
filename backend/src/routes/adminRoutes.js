import { Router } from 'express';
import { authenticate, requireStaffRole, requirePermission } from '../middleware/auth.js';
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
  updateOperatorQuota,
  updateOperator,
  getActivePackages,
} from '../services/adminService.js';
import {
  listPackages,
  createPackage,
  updatePackageStatus,
} from '../services/packageService.js';
import { generateReport, reportToCsv } from '../services/reportService.js';
import {
  createAdminSchema,
  createOperatorSchema,
  createPackageSchema,
  updateOperatorSchema,
  updateQuotaSchema,
  reportQuerySchema,
  listQuerySchema,
} from '../validators/schemas.js';

const router = Router();

router.use(authenticate, requireStaffRole());

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
        priceAmount: Number(pkg.price_amount),
        currencyCode: pkg.currency_code,
      })),
    });
  })
);

router.get(
  '/packages/crm-recommendations',
  requirePermission('createPackage'),
  asyncHandler(async (_req, res) => {
    const recommendations = await crmService.fetchOttProductCatalog();
    success(res, { recommendations });
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
    const isActive = Boolean(req.body.isActive);
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
    const isActive = Boolean(req.body.isActive);
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
  asyncHandler(async (req, res) => {
    const data = createOperatorSchema.parse(req.body);
    const operator = await createOperator(req.user.id, data, getClientMeta(req));
    success(res, operator, 201);
  })
);

router.patch(
  '/operators/:id/status',
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const isActive = Boolean(req.body.isActive);
    const result = await updateOperatorStatus(req.user.id, operatorId, isActive, getClientMeta(req));
    success(res, result);
  })
);

router.patch(
  '/operators/:id/quota',
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const { accountQuota } = updateQuotaSchema.parse(req.body);
    const result = await updateOperatorQuota(req.user.id, operatorId, accountQuota, getClientMeta(req));
    success(res, result);
  })
);

router.patch(
  '/operators/:id',
  asyncHandler(async (req, res) => {
    const operatorId = parseInt(req.params.id, 10);
    const data = updateOperatorSchema.parse(req.body);
    const result = await updateOperator(req.user.id, operatorId, data, getClientMeta(req));
    success(res, result);
  })
);

router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const filters = reportQuerySchema.parse(req.query);
    const report = await generateReport(filters);
    success(res, report);
  })
);

router.get(
  '/reports/export',
  asyncHandler(async (req, res) => {
    const filters = reportQuerySchema.parse(req.query);
    const report = await generateReport(filters);
    const csv = reportToCsv(report);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="report-${filters.reportType}.csv"`);
    res.send(csv);
  })
);

export default router;
