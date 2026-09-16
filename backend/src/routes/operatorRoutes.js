import { Router } from 'express';
import { authenticate, ensureActiveAccount, requireRole } from '../middleware/auth.js';
import { createAccountLimiter, walletTopupLimiter, walletStatusLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, success } from '../utils/errors.js';
import { getClientMeta } from '../services/auditService.js';
import {
  getOperatorStats,
  listAccounts,
  createSingleAccount,
  createBulkAccounts,
  searchCustomers,
  activateCustomer,
  topupCustomer,
} from '../services/operatorService.js';
import {
  generateWalletTransactionReport,
  walletTransactionReportToCsv,
} from '../services/walletTransactionReportService.js';
import {
  getOperatorWallet,
  getPendingWalletTopup,
  initiateTopup,
  listWalletTransactions,
  calculateTopupCredit,
} from '../services/walletService.js';
import { reconcileTopupPayment } from '../services/bmlWebhookService.js';
import {
  createAccountSchema,
  bulkAccountsSchema,
  listQuerySchema,
  operatorReportQuerySchema,
  walletTopupSchema,
  walletTopupStatusQuerySchema,
  customerSearchQuerySchema,
  activateCustomerSchema,
  walletTransactionQuerySchema,
} from '../validators/schemas.js';
import {
  generateOperatorReport,
  operatorReportToCsv,
} from '../services/operatorReportService.js';

const router = Router();

router.use(authenticate, ensureActiveAccount, requireRole('operator'));

router.get(
  '/wallet',
  asyncHandler(async (req, res) => {
    const wallet = await getOperatorWallet(req.user.id);
    success(res, wallet);
  })
);

router.get(
  '/wallet/transactions',
  asyncHandler(async (req, res) => {
    const queryParams = walletTransactionQuerySchema.parse(req.query);
    const result = await listWalletTransactions(req.user.id, queryParams);
    success(res, result);
  })
);

router.get(
  '/wallet/transactions/report',
  asyncHandler(async (req, res) => {
    const filters = walletTransactionQuerySchema.parse(req.query);
    const report = await generateWalletTransactionReport(req.user.id, filters);
    success(res, report);
  })
);

router.get(
  '/wallet/transactions/export',
  asyncHandler(async (req, res) => {
    const filters = walletTransactionQuerySchema.parse(req.query);
    const report = await generateWalletTransactionReport(req.user.id, filters);
    const csv = walletTransactionReportToCsv(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="wallet-transaction-report.csv"'
    );
    res.send(csv);
  })
);

router.get(
  '/wallet/topup/pending',
  asyncHandler(async (req, res) => {
    const pending = await getPendingWalletTopup(req.user.id);
    success(res, { pending });
  })
);

router.post(
  '/wallet/topup/preview',
  asyncHandler(async (req, res) => {
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
  walletTopupLimiter,
  asyncHandler(async (req, res) => {
    const { amount } = walletTopupSchema.parse(req.body);
    const result = await initiateTopup(req.user.id, amount, getClientMeta(req));
    success(res, result, 201);
  })
);

router.get(
  '/wallet/topup/status',
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
  '/customers/search',
  asyncHandler(async (req, res) => {
    const { phone, serviceTag } = customerSearchQuerySchema.parse(req.query);
    const result = await searchCustomers(req.user.id, phone, serviceTag);
    success(res, result);
  })
);

router.post(
  '/customers/activate',
  createAccountLimiter,
  asyncHandler(async (req, res) => {
    const data = activateCustomerSchema.parse(req.body);
    const result = await activateCustomer(req.user.id, data, getClientMeta(req));
    success(res, result, 201);
  })
);

router.post(
  '/customers/topup',
  createAccountLimiter,
  asyncHandler(async (req, res) => {
    const data = activateCustomerSchema.parse(req.body);
    const result = await topupCustomer(req.user.id, data, getClientMeta(req));
    success(res, result, 201);
  })
);

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
    const { accounts, packageIds } = bulkAccountsSchema.parse(req.body);
    const result = await createBulkAccounts(req.user.id, accounts, getClientMeta(req), packageIds);
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
