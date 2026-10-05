import { Router } from 'express';
import {
  authenticate,
  ensureActiveAccount,
  requireRole,
  requireOperatorPermission,
} from '../middleware/auth.js';
import {
  createAccountLimiter,
  walletTopupLimiter,
  walletStatusLimiter,
  customerSearchLimiter,
  reportLimiter,
  operatorReadLimiter,
  limitConcurrentPerUser,
} from '../middleware/rateLimit.js';
import { asyncHandler, success } from '../utils/errors.js';
import { parseIdParam } from '../utils/params.js';
import { refreshServiceTypes } from '../constants/serviceTags.js';
import { refreshAppSettings } from '../services/appSettingsService.js';
import { getClientMeta } from '../services/auditService.js';
import {
  getOperatorStats,
  listAccounts,
  exportAccountsCsv,
  createSingleAccount,
  createBulkAccounts,
  searchCustomers,
  crmTopupCustomer,
  subscribeCustomer,
} from '../services/operatorService.js';
import {
  generateWalletTransactionReport,
  streamWalletTransactionReportCsv,
} from '../services/walletTransactionReportService.js';
import { runWithReportSlot } from '../utils/reportConcurrency.js';
import { getDeveloperDocsForOperator } from '../services/developerDocsService.js';
import { listLiveMarketingAdsForOperators } from '../services/marketingAdService.js';
import {
  listActiveKnowledgeDocumentsForOperators,
  getKnowledgeDocumentFile,
} from '../services/knowledgeDocumentService.js';
import {
  getOperatorWallet,
  assertOperatorCanSelfTopup,
  getPendingWalletTopup,
  initiateTopup,
  getWalletTopupBill,
  listWalletTransactions,
  calculateTopupCredit,
} from '../services/walletService.js';
import { reconcileTopupPayment } from '../services/bmlWebhookService.js';
import {
  createAccountSchema,
  bulkAccountsSchema,
  operatorAccountsQuerySchema,
  operatorAccountsExportSchema,
  operatorReportQuerySchema,
  walletTopupSchema,
  walletTopupStatusQuerySchema,
  walletTopupBillQuerySchema,
  customerSearchQuerySchema,
  customerCrmTopupSchema,
  subscribeCustomerSchema,
  walletTransactionQuerySchema,
} from '../validators/schemas.js';
import {
  generateOperatorReport,
  streamOperatorReportCsv,
} from '../services/operatorReportService.js';

const router = Router();

router.use(authenticate, ensureActiveAccount, requireRole('operator'), refreshServiceTypes, refreshAppSettings);

// Dashboard and history reads share the database pool with every tenant's money paths.
const operatorReadGuards = [operatorReadLimiter, limitConcurrentPerUser(4, 'operator-read')];

router.get(
  '/wallet',
  requireOperatorPermission('wallet'),
  asyncHandler(async (req, res) => {
    const wallet = await getOperatorWallet(req.user.id);
    success(res, wallet);
  })
);

router.get(
  '/wallet/transactions',
  requireOperatorPermission('transactions'),
  operatorReadGuards,
  asyncHandler(async (req, res) => {
    const queryParams = walletTransactionQuerySchema.parse(req.query);
    const result = await listWalletTransactions(req.user.id, queryParams);
    success(res, result);
  })
);

router.get(
  '/wallet/transactions/report',
  requireOperatorPermission('transactions'),
  reportLimiter,
  asyncHandler(async (req, res) => {
    const filters = walletTransactionQuerySchema.parse(req.query);
    await runWithReportSlot(req, async () => {
      const report = await generateWalletTransactionReport(req.user.id, filters);
      success(res, report);
    });
  })
);

router.get(
  '/wallet/transactions/export',
  requireOperatorPermission('transactions'),
  reportLimiter,
  asyncHandler(async (req, res) => {
    const filters = walletTransactionQuerySchema.parse(req.query);
    await runWithReportSlot(req, async () => {
      await streamWalletTransactionReportCsv(res, req.user.id, filters);
    });
  })
);

router.get(
  '/wallet/topup/pending',
  requireOperatorPermission('wallet'),
  asyncHandler(async (req, res) => {
    const pending = await getPendingWalletTopup(req.user.id);
    success(res, { pending });
  })
);

router.post(
  '/wallet/topup/preview',
  requireOperatorPermission('wallet'),
  asyncHandler(async (req, res) => {
    await assertOperatorCanSelfTopup(req.user.id);
    const { amount } = walletTopupSchema.parse(req.body);
    const wallet = await getOperatorWallet(req.user.id);
    const breakdown = calculateTopupCredit(amount, {
      commissionType: wallet.walletCommissionType,
      commissionValue: wallet.walletCommissionValue,
      gstRate: wallet.gstRate,
    });
    success(res, {
      ...breakdown,
      currencyCode: wallet.currencyCode,
      walletCommissionType: wallet.walletCommissionType,
      walletCommissionValue: wallet.walletCommissionValue,
      gstRate: wallet.gstRate,
      gstRatePercent: wallet.gstRatePercent,
    });
  })
);

router.post(
  '/wallet/topup',
  requireOperatorPermission('wallet'),
  walletTopupLimiter,
  asyncHandler(async (req, res) => {
    const { amount } = walletTopupSchema.parse(req.body);
    const result = await initiateTopup(req.user.id, amount, getClientMeta(req));
    success(res, result, 201);
  })
);

router.get(
  '/wallet/topup/status',
  requireOperatorPermission('wallet'),
  walletStatusLimiter,
  asyncHandler(async (req, res) => {
    const { reference, transactionId } = walletTopupStatusQuerySchema.parse(req.query);
    const result = await reconcileTopupPayment({
      operatorId: req.user.id,
      reference,
      bmlTransactionId: transactionId,
      reqMeta: getClientMeta(req),
    });
    success(res, result);
  })
);

router.get(
  '/wallet/topup/bill',
  requireOperatorPermission('wallet'),
  walletStatusLimiter,
  asyncHandler(async (req, res) => {
    const { reference } = walletTopupBillQuerySchema.parse(req.query);
    const bill = await getWalletTopupBill(req.user.id, reference);
    success(res, bill);
  })
);

router.get(
  '/customers/search',
  requireOperatorPermission('customers'),
  customerSearchLimiter,
  asyncHandler(async (req, res) => {
    const { phone, code, serviceTag } = customerSearchQuerySchema.parse(req.query);
    const result = await searchCustomers(req.user.id, { phone, code }, serviceTag);
    success(res, result);
  })
);

router.post(
  '/customers/crm-topup',
  requireOperatorPermission('customers'),
  createAccountLimiter,
  asyncHandler(async (req, res) => {
    const data = customerCrmTopupSchema.parse(req.body);
    const result = await crmTopupCustomer(req.user.id, data, getClientMeta(req));
    success(res, result, 201);
  })
);

router.post(
  '/customers/subscribe',
  requireOperatorPermission('customers'),
  createAccountLimiter,
  asyncHandler(async (req, res) => {
    const data = subscribeCustomerSchema.parse(req.body);
    const result = await subscribeCustomer(req.user.id, data, getClientMeta(req));
    success(res, result, 201);
  })
);

/** Operator API documentation: only for operators Medianet has enabled API access for. */
router.get(
  '/developer-docs',
  operatorReadLimiter,
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    success(res, await getDeveloperDocsForOperator(req.user.id));
  })
);

router.get(
  '/stats',
  requireOperatorPermission('dashboard'),
  operatorReadGuards,
  asyncHandler(async (req, res) => {
    const stats = await getOperatorStats(req.user.id);
    success(res, stats);
  })
);

router.get(
  '/marketing-ads',
  requireOperatorPermission('dashboard'),
  asyncHandler(async (_req, res) => {
    const ads = await listLiveMarketingAdsForOperators();
    success(res, { ads });
  })
);

router.get(
  '/knowledge-documents',
  requireOperatorPermission('dashboard'),
  asyncHandler(async (_req, res) => {
    const documents = await listActiveKnowledgeDocumentsForOperators();
    success(res, { documents });
  })
);

router.get(
  '/knowledge-documents/:id/download',
  requireOperatorPermission('dashboard'),
  asyncHandler(async (req, res) => {
    const docId = parseIdParam(req.params.id);
    const { row, filePath } = await getKnowledgeDocumentFile(docId, { activeOnly: true });
    res.setHeader('Content-Type', row.mime_type);
    res.download(filePath, row.file_original_name);
  })
);

router.get(
  '/accounts',
  requireOperatorPermission('accounts'),
  operatorReadGuards,
  asyncHandler(async (req, res) => {
    const queryParams = operatorAccountsQuerySchema.parse(req.query);
    const result = await listAccounts(req.user.id, queryParams);
    success(res, result);
  })
);

router.get(
  '/accounts/export',
  requireOperatorPermission('accounts'),
  reportLimiter,
  asyncHandler(async (req, res) => {
    const filters = operatorAccountsExportSchema.parse(req.query);
    await runWithReportSlot(req, async () => {
      const csv = await exportAccountsCsv(req.user.id, filters);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="customer-history.csv"');
      res.send(csv);
    });
  })
);

router.post(
  '/accounts',
  requireOperatorPermission('createAccount'),
  createAccountLimiter,
  asyncHandler(async (req, res) => {
    const account = createAccountSchema.parse(req.body);
    const result = await createSingleAccount(req.user.id, account, getClientMeta(req));
    success(res, result, 201);
  })
);

router.post(
  '/accounts/bulk',
  requireOperatorPermission('bulkUpload'),
  createAccountLimiter,
  asyncHandler(async (req, res) => {
    const { accounts, packageIds } = bulkAccountsSchema.parse(req.body);
    const result = await createBulkAccounts(req.user.id, accounts, getClientMeta(req), packageIds);
    success(res, result, 201);
  })
);

router.get(
  '/reports',
  requireOperatorPermission('reports'),
  reportLimiter,
  asyncHandler(async (req, res) => {
    const filters = operatorReportQuerySchema.parse(req.query);
    await runWithReportSlot(req, async () => {
      const report = await generateOperatorReport(req.user.id, filters);
      success(res, report);
    });
  })
);

router.get(
  '/reports/export',
  requireOperatorPermission('reports'),
  reportLimiter,
  asyncHandler(async (req, res) => {
    const filters = operatorReportQuerySchema.parse(req.query);
    await runWithReportSlot(req, async () => {
      await streamOperatorReportCsv(res, req.user.id, filters);
    });
  })
);

export default router;
