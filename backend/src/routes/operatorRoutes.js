import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { createAccountLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, success } from '../utils/errors.js';
import { getClientMeta } from '../services/auditService.js';
import {
  getOperatorStats,
  listAccounts,
  createSingleAccount,
  createBulkAccounts,
} from '../services/operatorService.js';
import {
  createAccountSchema,
  bulkAccountsSchema,
  listQuerySchema,
  operatorReportQuerySchema,
} from '../validators/schemas.js';
import {
  generateOperatorReport,
  operatorReportToCsv,
} from '../services/operatorReportService.js';

const router = Router();

router.use(authenticate, requireRole('operator'));

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const stats = await getOperatorStats(req.user.id);
    success(res, stats);
  })
);

router.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const queryParams = listQuerySchema.parse(req.query);
    const result = await listAccounts(req.user.id, queryParams);
    success(res, result);
  })
);

router.post(
  '/accounts',
  createAccountLimiter,
  asyncHandler(async (req, res) => {
    const account = createAccountSchema.parse(req.body);
    const result = await createSingleAccount(req.user.id, account, getClientMeta(req));
    success(res, result, 201);
  })
);

router.post(
  '/accounts/bulk',
  createAccountLimiter,
  asyncHandler(async (req, res) => {
    const { accounts } = bulkAccountsSchema.parse(req.body);
    const result = await createBulkAccounts(req.user.id, accounts, getClientMeta(req));
    success(res, result, 201);
  })
);

router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const filters = operatorReportQuerySchema.parse(req.query);
    const report = await generateOperatorReport(req.user.id, filters);
    success(res, report);
  })
);

router.get(
  '/reports/export',
  asyncHandler(async (req, res) => {
    const filters = operatorReportQuerySchema.parse(req.query);
    const report = await generateOperatorReport(req.user.id, filters);
    const csv = operatorReportToCsv(report);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="operator-activity-report.csv"');
    res.send(csv);
  })
);

export default router;
