import { Router } from 'express';
import { asyncHandler, success, AppError } from '../utils/errors.js';
import { refreshServiceTypes } from '../constants/serviceTags.js';
import { refreshAppSettings } from '../services/appSettingsService.js';
import { getClientMeta } from '../services/auditService.js';
import {
  authenticateApiKey,
  apiAuthFailureLimiter,
  apiReadLimiter,
  apiCustomerLimiter,
  apiWriteLimiter,
} from '../middleware/apiKeyAuth.js';
import {
  getAccount,
  getWallet,
  listPackages,
  findCustomers,
  getCustomerBalance,
  getCustomerSubscriptions,
  getCustomerOffers,
  topUpCustomer,
  purchase,
  listTransactions,
  getTransaction,
  runIdempotent,
  getRequestStatus,
} from '../services/partnerApiService.js';
import {
  partnerIdempotencyKeySchema,
  partnerCustomerSearchSchema,
  partnerCustomerSchema,
  partnerCustomerDeviceSchema,
  partnerPackagesSchema,
  partnerTopupSchema,
  partnerSubscribeSchema,
  partnerRenewSchema,
  partnerUpgradeSchema,
  partnerTransactionsSchema,
  partnerReferenceSchema,
} from '../validators/schemas.js';

/*
 * Partner API v1, mounted at /api/v1. Authenticated by operator API key only: portal sessions
 * and cookies are not accepted here, and an API key is not accepted on the portal routes.
 */
const router = Router();

router.use(apiAuthFailureLimiter, authenticateApiKey, refreshServiceTypes, refreshAppSettings);

function idempotencyKey(req) {
  const header = req.headers['idempotency-key'];
  if (!header) {
    throw new AppError('The Idempotency-Key header is required for this request', 400, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  return partnerIdempotencyKeySchema.parse(header);
}

/*
 * Request style: anything that takes input is a POST with a JSON body, including lookups, so
 * phone numbers and service codes never appear in URLs or access logs. GET is used only where
 * there is no input beyond an identifier of the caller's own (a reference or idempotency key).
 */

/** A lookup: validate the JSON body and answer 200. Nothing is changed, so it can be repeated freely. */
function readRoute(schema, work) {
  return asyncHandler(async (req, res) => {
    const body = schema.parse(req.body || {});
    success(res, await work(req, body));
  });
}

/** Money endpoints: validate, then run once per Idempotency-Key and replay on repeats. */
function moneyRoute(endpoint, schema, work) {
  return asyncHandler(async (req, res) => {
    const key = idempotencyKey(req);
    const { customerId, ...body } = schema.parse(req.body || {});
    const outcome = await runIdempotent(
      req.apiClient,
      { key, endpoint, payload: { customerId, ...body } },
      () => work(req, customerId, body, key)
    );
    if (outcome.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(outcome.statusCode).json(outcome.body);
  });
}

router.get(
  '/account',
  apiReadLimiter,
  asyncHandler(async (req, res) => success(res, await getAccount(req.apiClient)))
);

router.get(
  '/wallet',
  apiReadLimiter,
  asyncHandler(async (req, res) => success(res, await getWallet(req.apiClient)))
);

router.post(
  '/packages/list',
  apiReadLimiter,
  readRoute(partnerPackagesSchema, (req, body) => listPackages(req.apiClient, body))
);

router.post(
  '/customers/search',
  apiCustomerLimiter,
  readRoute(partnerCustomerSearchSchema, (req, body) => findCustomers(req.apiClient, body))
);

router.post(
  '/customers/balance',
  apiCustomerLimiter,
  readRoute(partnerCustomerSchema, (req, { customerId, ...ref }) =>
    getCustomerBalance(req.apiClient, customerId, ref)
  )
);

router.post(
  '/customers/subscriptions',
  apiCustomerLimiter,
  readRoute(partnerCustomerDeviceSchema, (req, { customerId, ...ref }) =>
    getCustomerSubscriptions(req.apiClient, customerId, ref)
  )
);

router.post(
  '/customers/offers',
  apiCustomerLimiter,
  readRoute(partnerCustomerDeviceSchema, (req, { customerId, ...ref }) =>
    getCustomerOffers(req.apiClient, customerId, ref)
  )
);

router.post(
  '/customers/topup',
  apiWriteLimiter,
  moneyRoute('topup', partnerTopupSchema, (req, customerId, body, key) =>
    topUpCustomer(req.apiClient, customerId, body, getClientMeta(req), key)
  )
);

router.post(
  '/customers/subscribe',
  apiWriteLimiter,
  moneyRoute('subscribe', partnerSubscribeSchema, (req, customerId, body, key) =>
    purchase(req.apiClient, customerId, body, 'subscribe', getClientMeta(req), key)
  )
);

router.post(
  '/customers/renew',
  apiWriteLimiter,
  moneyRoute('renew', partnerRenewSchema, (req, customerId, body, key) =>
    purchase(req.apiClient, customerId, body, 'renew', getClientMeta(req), key)
  )
);

router.post(
  '/customers/upgrade',
  apiWriteLimiter,
  moneyRoute('upgrade', partnerUpgradeSchema, (req, customerId, body, key) =>
    purchase(req.apiClient, customerId, body, 'upgrade', getClientMeta(req), key)
  )
);

router.post(
  '/transactions/list',
  apiReadLimiter,
  readRoute(partnerTransactionsSchema, (req, body) => listTransactions(req.apiClient, body))
);

router.get(
  '/transactions/:reference',
  apiReadLimiter,
  asyncHandler(async (req, res) => {
    const reference = partnerReferenceSchema.parse(req.params.reference);
    success(res, await getTransaction(req.apiClient, reference));
  })
);

router.get(
  '/requests/:idempotencyKey',
  apiReadLimiter,
  asyncHandler(async (req, res) => {
    const key = partnerIdempotencyKeySchema.parse(req.params.idempotencyKey);
    success(res, await getRequestStatus(req.apiClient, key));
  })
);

export default router;
