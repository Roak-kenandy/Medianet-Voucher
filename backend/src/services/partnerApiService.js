/*
 * Partner API (v1): the same operations the operator portal performs, exposed to an operator's
 * own systems through an API key. Nothing here decides what an operator may do. The customer
 * types, sales models, packages and eligibility rules are enforced by the services the portal
 * already uses, so the two channels cannot drift apart. This file only shapes responses and
 * makes money requests safe to retry.
 */
import crypto from 'crypto';
import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { getServiceTypeLabel } from '../constants/serviceTags.js';
import { getOperatorServiceTypeKeys } from './crmConfigService.js';
import { getOperatorPackages, getPackageCatalog } from './packageService.js';
import { getOperatorWallet, listWalletTransactions } from './walletService.js';
import { searchCustomers, crmTopupCustomer, subscribeCustomer } from './operatorService.js';

const money = (value) => (value == null ? null : Math.round(Number(value) * 100) / 100);

/* ------------------------------------------------------------------ account & catalogue */

export async function getAccount(apiClient) {
  const [wallet, typeKeys] = await Promise.all([
    getOperatorWallet(apiClient.operatorId),
    getOperatorServiceTypeKeys(apiClient.operatorId),
  ]);
  return {
    operator: { id: apiClient.operatorId, name: apiClient.operatorName },
    apiKey: { name: apiClient.apiKeyName, prefix: apiClient.keyPrefix },
    serviceTypes: typeKeys.map((key, index) => ({
      key,
      label: getServiceTypeLabel(key),
      isDefault: index === 0,
    })),
    wallet: mapWallet(wallet),
  };
}

function mapWallet(wallet) {
  return {
    balance: money(wallet.balance),
    currency: wallet.currencyCode,
    freeAccounts: {
      limit: Number(wallet.trialAccountLimit) || 0,
      used: Number(wallet.trialAccountsUsed) || 0,
      remaining: Number(wallet.trialAccountsRemaining) || 0,
    },
  };
}

export async function getWallet(apiClient) {
  return mapWallet(await getOperatorWallet(apiClient.operatorId));
}

/** The packages this operator may sell, optionally for one customer type. */
export async function listPackages(apiClient, { serviceType } = {}) {
  const typeKeys = await getOperatorServiceTypeKeys(apiClient.operatorId);
  if (serviceType && !typeKeys.includes(serviceType)) {
    throw new AppError('This customer type is not enabled for your account', 403, 'SERVICE_NOT_ALLOWED');
  }
  const wanted = serviceType ? [serviceType] : typeKeys;

  const offered = (await getOperatorPackages(apiClient.operatorId)).filter(
    (pkg) => pkg.is_active && wanted.includes(pkg.service_tag || 'OTT')
  );
  // Add-on requirements live on the catalogue rows.
  const requirements = new Map();
  for (const type of wanted) {
    for (const pkg of await getPackageCatalog(type)) requirements.set(Number(pkg.id), pkg.requiredPackageIds || []);
  }
  const offeredIds = new Set(offered.map((pkg) => Number(pkg.id)));

  return {
    packages: offered.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      serviceType: pkg.service_tag || 'OTT',
      price: money(pkg.price_amount),
      currency: pkg.currency_code,
      role: pkg.package_role || 'standalone',
      upgradeFamily: pkg.upgrade_family || null,
      upgradeTier: pkg.upgrade_tier ?? null,
      // For an add-on: it can only be sold with one of these base packages.
      requiresOneOf: (requirements.get(Number(pkg.id)) || []).filter((id) => offeredIds.has(Number(id))),
      salesModel: pkg.sales_model_name || null,
    })),
  };
}

/* ------------------------------------------------------------------ customers */

function mapBalance(account) {
  if (!account) return null;
  return {
    // Positive `balance` is money the customer owes; negative is credit they hold.
    balance: money(account.balance),
    credit: money(account.creditAmount),
    due: money(account.dueAmount),
    currency: account.currencyCode,
    accountState: account.state,
  };
}

function mapSubscription(service) {
  return {
    serviceId: service.id,
    name: service.name,
    sku: service.sku,
    state: service.state,
    price: money(service.price),
    currency: service.currencyCode,
    billingPeriod: service.billingPeriod,
    autoRenew: service.autoRenew,
    inTrial: service.inTrial,
    activatedOn: service.activatedOn,
    dueDate: service.dueDate,
  };
}

function mapEligibility(customer, packagesById) {
  if (customer.packageOptions == null) return null;
  return customer.packageOptions
    .filter((option) => packagesById.has(option.packageId))
    .map((option) => {
      const pkg = packagesById.get(option.packageId);
      const listPrice = money(pkg.price_amount);
      const isChange = option.action === 'upgrade' && option.upgradeMode === 'change';
      return {
        packageId: option.packageId,
        name: pkg.name,
        role: option.role,
        // subscribe | renew | upgrade, or null when it cannot be sold to this device.
        action: option.action,
        available: option.eligible,
        reason: option.eligible ? null : option.reason,
        // What the operator wallet is charged if bought now.
        price: option.eligible ? (isChange ? money(option.charge.amount) : listPrice) : null,
        listPrice,
        currency: pkg.currency_code,
        upgrade:
          option.action === 'upgrade'
            ? {
                // change: switched in place, due date kept, credit for unused days applied.
                // replace: old package cancelled and this one started new at list price.
                mode: option.upgradeMode,
                replaces: option.replaces ? { packageId: option.replaces.packageId, name: option.replaces.name } : null,
                credit: isChange ? money(option.charge.credit) : 0,
                cancelsAddons: (option.cancels || []).map((item) => ({ packageId: item.packageId, name: item.name })),
              }
            : null,
        // A blocked add-on becomes available when bought together with one of these.
        requiresOneOf: option.eligible ? [] : option.requiresOneOf || [],
      };
    });
}

function mapCustomer(customer, packagesById) {
  return {
    customerId: customer.id,
    deviceId: customer.deviceId,
    serviceCode: customer.deviceCode || null,
    customerCode: customer.code,
    name: customer.name,
    phone: customer.phone,
    serviceType: customer.serviceTag,
    deviceCount: customer.deviceCount || 0,
    balance: mapBalance(customer.account),
    subscriptions: customer.services == null ? null : customer.services.map(mapSubscription),
    eligibility: mapEligibility(customer, packagesById),
  };
}

async function lookupCustomers(apiClient, { serviceType, serviceCode, phone }) {
  const [result, operatorPackages] = await Promise.all([
    searchCustomers(apiClient.operatorId, { phone, code: serviceCode }, serviceType),
    getOperatorPackages(apiClient.operatorId),
  ]);
  const packagesById = new Map(operatorPackages.map((pkg) => [Number(pkg.id), pkg]));
  return (result.customers || []).map((customer) => mapCustomer(customer, packagesById));
}

/** One entry per device: a package is always sold to a device. */
export async function findCustomers(apiClient, ref) {
  return { customers: await lookupCustomers(apiClient, ref) };
}

/**
 * A customer is always addressed together with the phone number or service code they were
 * found by, so an id alone never opens someone's account.
 */
async function getCustomerEntries(apiClient, customerId, ref) {
  const entries = (await lookupCustomers(apiClient, ref)).filter((entry) => entry.customerId === customerId);
  if (!entries.length) {
    throw new AppError(
      'No customer with this id matches the phone number or service code for this customer type',
      404,
      'CUSTOMER_NOT_FOUND'
    );
  }
  return entries;
}

function pickDevice(entries, deviceId) {
  if (deviceId) {
    const entry = entries.find((item) => item.deviceId === deviceId);
    if (!entry) throw new AppError('This device does not belong to the customer', 404, 'DEVICE_NOT_FOUND');
    return entry;
  }
  if (entries.length > 1) {
    throw new AppError(
      'This customer has more than one device. Send deviceId, or look the customer up by serviceCode.',
      400,
      'DEVICE_REQUIRED'
    );
  }
  return entries[0];
}

export async function getCustomerBalance(apiClient, customerId, ref) {
  const [entry] = await getCustomerEntries(apiClient, customerId, ref);
  if (!entry.balance) {
    throw new AppError('The customer balance could not be read from CRM. Try again.', 502, 'CRM_ERROR');
  }
  return { customerId, name: entry.name, ...entry.balance };
}

export async function getCustomerSubscriptions(apiClient, customerId, { deviceId, ...ref }) {
  const entry = pickDevice(await getCustomerEntries(apiClient, customerId, ref), deviceId);
  if (entry.subscriptions == null) {
    throw new AppError('The customer subscriptions could not be read from CRM. Try again.', 502, 'CRM_ERROR');
  }
  return {
    customerId,
    deviceId: entry.deviceId,
    serviceCode: entry.serviceCode,
    subscriptions: entry.subscriptions,
  };
}

export async function getPackageEligibility(apiClient, customerId, { deviceId, ...ref }) {
  const entry = pickDevice(await getCustomerEntries(apiClient, customerId, ref), deviceId);
  if (entry.eligibility == null) {
    throw new AppError('Eligibility needs the customer subscriptions, which could not be read from CRM. Try again.', 502, 'CRM_ERROR');
  }
  return { customerId, deviceId: entry.deviceId, serviceCode: entry.serviceCode, packages: entry.eligibility };
}

/**
 * Only what can be sold to this device right now, ready to show as a list: packages to renew,
 * the upgrades open from the current base package, and anything that can be added. A device
 * with nothing active gets the whole catalogue. Package eligibility is the same data including
 * what is not available and why.
 */
export async function getAllowedPackages(apiClient, customerId, { deviceId, ...ref }) {
  const entry = pickDevice(await getCustomerEntries(apiClient, customerId, ref), deviceId);
  if (entry.eligibility == null) {
    throw new AppError('Packages need the customer subscriptions, which could not be read from CRM. Try again.', 502, 'CRM_ERROR');
  }
  const packages = entry.eligibility
    // An add-on that only needs its base bought in the same request still counts as sellable.
    .filter((item) => item.available || item.requiresOneOf.length)
    .map(({ available, reason, requiresOneOf, ...item }) => ({
      ...item,
      action: item.action || 'subscribe',
      price: item.price ?? item.listPrice,
      // Not empty: sell it together with one of these base packages.
      requiresOneOf,
    }));
  return {
    customerId,
    deviceId: entry.deviceId,
    serviceCode: entry.serviceCode,
    hasActivePackages: entry.subscriptions.length > 0,
    packages,
  };
}

/* ------------------------------------------------------------------ money */

function channelMeta(apiClient, reqMeta, idempotencyKey) {
  return {
    ...reqMeta,
    channel: { channel: 'api', apiKeyId: apiClient.apiKeyId, idempotencyKey },
  };
}

function customerRefForService(customerId, body) {
  return {
    crmContactId: customerId,
    serviceTag: body.serviceType,
    ...(body.serviceCode ? { serviceCode: body.serviceCode } : { phoneNumber: body.phone }),
  };
}

export async function topUpCustomer(apiClient, customerId, body, reqMeta, idempotencyKey) {
  const result = await crmTopupCustomer(
    apiClient.operatorId,
    { ...customerRefForService(customerId, body), amount: body.amount },
    channelMeta(apiClient, reqMeta, idempotencyKey)
  );
  return {
    reference: result.reference,
    status: 'completed',
    customerId,
    name: result.fullName,
    amount: money(result.amountCharged),
    currency: result.currencyCode,
    wallet: { balanceBefore: money(result.balanceBefore), balanceAfter: money(result.balanceAfter) },
  };
}

/** New subscription, renewal or upgrade; `expectedAction` is the endpoint that was called. */
export async function purchase(apiClient, customerId, body, expectedAction, reqMeta, idempotencyKey) {
  const result = await subscribeCustomer(
    apiClient.operatorId,
    {
      ...customerRefForService(customerId, body),
      ...(body.deviceId ? { deviceId: body.deviceId } : {}),
      packageIds: body.packageIds || (body.packageId ? [body.packageId] : []),
      renewAll: body.all === true,
      amount: body.amount,
      expectedAction,
    },
    channelMeta(apiClient, reqMeta, idempotencyKey)
  );
  return {
    reference: result.reference,
    status: 'completed',
    action: result.action,
    customerId,
    deviceId: result.deviceId,
    serviceCode: result.serviceCode,
    name: result.fullName,
    packages: result.packageIds.map((id, index) => ({ id, name: result.packageNames[index] })),
    amountCharged: money(result.amountCharged),
    listPrice: money(result.listPrice),
    currency: result.currencyCode,
    // True when a free-account slot paid for a new subscription instead of the wallet.
    usedFreeAccount: result.chargeType === 'trial',
    upgrade:
      result.action === 'upgrade'
        ? {
            mode: result.upgradeMode,
            replaced: result.replacedPackage,
            credit: money(result.creditApplied),
            cancelledAddons: result.cancelledAddons,
          }
        : null,
    wallet: { balanceBefore: money(result.balanceBefore), balanceAfter: money(result.balanceAfter) },
  };
}

/* ------------------------------------------------------------------ transactions */

function readMetadata(value) {
  if (!value) return {};
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
}

function mapTransaction(row) {
  const metadata = readMetadata(row.metadata);
  return {
    reference: row.reference,
    type: row.type,
    activity: metadata.activity || row.type,
    status: row.status,
    // completed | pending | needs_reconciliation | refunded: where the CRM side stands.
    crmState: metadata.crmState || null,
    amount: money(row.amount),
    currency: row.currencyCode,
    balanceBefore: money(row.balanceBefore),
    balanceAfter: money(row.balanceAfter),
    description: row.description,
    customerId: metadata.crmContactId || null,
    customerName: metadata.customerName || null,
    phone: metadata.phoneNumber || null,
    serviceCode: metadata.serviceCode || null,
    serviceType: metadata.serviceTag || null,
    packageIds: metadata.packageIds || [],
    packageNames: metadata.packageNames || [],
    channel: metadata.channel || 'portal',
    idempotencyKey: metadata.idempotencyKey || null,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export async function listTransactions(apiClient, filters) {
  const result = await listWalletTransactions(apiClient.operatorId, filters, { includeMetadata: true });
  return { transactions: result.transactions.map(mapTransaction), pagination: result.pagination };
}

export async function getTransaction(apiClient, reference) {
  const rows = await query(
    `SELECT id, type, status, amount, balance_before AS balanceBefore, balance_after AS balanceAfter,
            net_amount AS netAmount, commission_amount AS commissionAmount,
            currency_code AS currencyCode, reference, description, metadata,
            created_at AS createdAt, completed_at AS completedAt
     FROM wallet_transactions
     WHERE operator_id = ? AND reference = ?
     LIMIT 1`,
    [apiClient.operatorId, reference]
  );
  if (!rows.length) throw new AppError('Transaction not found', 404, 'NOT_FOUND');
  return mapTransaction(rows[0]);
}

/* ------------------------------------------------------------------ idempotency */

function hashRequest(endpoint, payload) {
  return crypto.createHash('sha256').update(`${endpoint}\n${JSON.stringify(payload)}`).digest('hex');
}

function parseStored(row) {
  const body = typeof row.response_body === 'string' ? JSON.parse(row.response_body) : row.response_body;
  return { statusCode: row.response_status, body };
}

/**
 * Runs a money request at most once per Idempotency-Key. The first call does the work and its
 * answer is stored; a repeat with the same key and the same request gets that answer back
 * without anything being charged again. Returns { statusCode, body, replayed }.
 *
 * A request that ended with nothing charged (refused, CRM busy, or CRM refused the payment and
 * the wallet was refunded) releases its key, so the caller can retry with the same key. A
 * success is kept, and so is any outcome where the charge stands or is unknown, because a
 * second attempt could charge twice.
 */
const NOTHING_CHARGED_CODES = new Set([
  'CRM_BUSY',
  'CRM_ERROR',
  'CRM_PAYMENT_REJECTED',
  'CRM_PROVISION_FAILED',
]);

function leftNothingCharged(err) {
  return err instanceof AppError && (err.statusCode < 500 || NOTHING_CHARGED_CODES.has(err.code));
}

export async function runIdempotent(apiClient, { key, endpoint, payload }, work) {
  const requestHash = hashRequest(endpoint, payload);

  const claim = await query(
    `INSERT IGNORE INTO api_idempotency_keys (operator_id, api_key_id, idempotency_key, endpoint, request_hash)
     VALUES (?, ?, ?, ?, ?)`,
    [apiClient.operatorId, apiClient.apiKeyId, key, endpoint, requestHash]
  );

  if (!claim.affectedRows) {
    const [existing] = await query(
      `SELECT request_hash, status, response_status, response_body
       FROM api_idempotency_keys WHERE operator_id = ? AND idempotency_key = ? LIMIT 1`,
      [apiClient.operatorId, key]
    );
    if (!existing) {
      // Released between the insert and the read; the caller can simply retry.
      throw new AppError('Request with this Idempotency-Key just finished. Retry.', 409, 'IDEMPOTENCY_IN_PROGRESS');
    }
    if (existing.request_hash !== requestHash) {
      throw new AppError(
        'This Idempotency-Key was already used for a different request',
        422,
        'IDEMPOTENCY_KEY_REUSED'
      );
    }
    if (existing.status !== 'completed') {
      throw new AppError(
        'A request with this Idempotency-Key is still being processed. Check GET /requests/{key}.',
        409,
        'IDEMPOTENCY_IN_PROGRESS'
      );
    }
    return { ...parseStored(existing), replayed: true };
  }

  const store = (statusCode, body) =>
    query(
      `UPDATE api_idempotency_keys
       SET status = 'completed', response_status = ?, response_body = ?, completed_at = NOW()
       WHERE operator_id = ? AND idempotency_key = ?`,
      [statusCode, JSON.stringify(body), apiClient.operatorId, key]
    );
  const release = () =>
    query('DELETE FROM api_idempotency_keys WHERE operator_id = ? AND idempotency_key = ?', [
      apiClient.operatorId,
      key,
    ]);

  try {
    const data = await work();
    const body = { success: true, data };
    await store(201, body).catch((err) => console.error('[API] Idempotency store failed:', err.message));
    return { statusCode: 201, body, replayed: false };
  } catch (err) {
    const known = err instanceof AppError;
    if (leftNothingCharged(err)) {
      await release().catch(() => {});
      throw err;
    }
    const statusCode = known ? err.statusCode : 500;
    const body = {
      success: false,
      code: known ? err.code : 'INTERNAL_ERROR',
      message: known ? err.message : 'An unexpected error occurred',
    };
    if (!known) console.error('[API] Unhandled error in idempotent request:', err);
    await store(statusCode, body).catch((storeErr) =>
      console.error('[API] Idempotency store failed:', storeErr.message)
    );
    return { statusCode, body, replayed: false };
  }
}

/** What happened to a money request, looked up by its Idempotency-Key. */
export async function getRequestStatus(apiClient, key) {
  const [row] = await query(
    `SELECT endpoint, status, response_status, response_body, created_at, completed_at
     FROM api_idempotency_keys WHERE operator_id = ? AND idempotency_key = ? LIMIT 1`,
    [apiClient.operatorId, key]
  );
  if (!row) {
    throw new AppError(
      'No request is recorded for this Idempotency-Key. It was never received, or it ended with nothing charged.',
      404,
      'NOT_FOUND'
    );
  }
  const stored = row.status === 'completed' ? parseStored(row) : null;
  return {
    idempotencyKey: key,
    endpoint: row.endpoint,
    state: row.status,
    httpStatus: stored?.statusCode ?? null,
    response: stored?.body ?? null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}


const IDEMPOTENCY_RETENTION_DAYS = 30;

/** Keys are kept for 30 days; after that the same key would be treated as a new request. */
export async function purgeOldIdempotencyKeys() {
  await query('DELETE FROM api_idempotency_keys WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)', [
    IDEMPOTENCY_RETENTION_DAYS,
  ]);
}
