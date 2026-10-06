import { config } from '../config/index.js';
import { query, getConnection } from '../db/pool.js';
import { AppError, classifyCrmFailure } from '../utils/errors.js';
import { logAudit } from './auditService.js';
import { crmService } from './crmService.js';
import { buildDailyTrend } from '../utils/chartData.js';
import { paginationSql } from '../utils/pagination.js';
import { withCrmSlot, withCrmReadSlot } from '../utils/crmConcurrency.js';
import { operatorSpendDebitSql } from '../utils/walletSql.js';
import {
  getOperatorPackageIds,
  getOperatorPackages,
  getPackageCatalog,
  toEligibilityPackage,
  sumPackagePrices,
  assertPackagesAssignable,
} from './packageService.js';
import {
  debitWallet,
  generateReference,
  mergeTransactionMetadata,
  refundWalletDebit,
} from './walletService.js';
import { assertServiceTag, listServiceTypesPublic } from '../constants/serviceTags.js';
import { getOperatorServiceTypeKeys } from './crmConfigService.js';
import { evaluatePackageOptions, resolvePurchase } from '../utils/packageEligibility.js';
import {
  formatTrialForResponse,
  getTrialQuotaInfo,
  countPaidAccountCreations,
} from '../utils/trial.js';
import { csvEscape, csvRow } from '../utils/csv.js';

/**
 * Where a sale came from. Portal requests carry nothing; partner API requests carry the key
 * that made them and their idempotency key, recorded on the ledger row and the audit entry.
 */
function channelMetadata(reqMeta = {}) {
  return reqMeta.channel ? { ...reqMeta.channel } : {};
}

/** Adding, renewing and upgrading a package are all "subscribe" activity in reports and filters. */
const SUBSCRIBE_ACTIVITIES = ['customer_subscribe', 'customer_renew', 'customer_upgrade'];
const PURCHASE_ACTIVITY = {
  subscribe: 'customer_subscribe',
  renew: 'customer_renew',
  upgrade: 'customer_upgrade',
};

/**
 * What the eligibility rules need for one operator and customer type: every package of the
 * type (to recognise what a customer holds) and the active ones this operator may sell.
 */
async function loadEligibilityContext(operatorId, serviceTag) {
  const [catalog, operatorPackages] = await Promise.all([
    getPackageCatalog(serviceTag),
    getOperatorPackages(operatorId),
  ]);
  const requirementsById = new Map(catalog.map((pkg) => [Number(pkg.id), pkg.requiredPackageIds]));
  const offered = operatorPackages
    .filter((pkg) => pkg.is_active && (pkg.service_tag || 'OTT') === serviceTag)
    .map((pkg) => ({
      ...toEligibilityPackage(pkg),
      requiredPackageIds: requirementsById.get(Number(pkg.id)) || [],
    }));
  return { catalog, offered };
}

/** The operator must be allowed to serve this customer type (staff-managed allow-list). */
async function assertOperatorServiceTag(operatorId, serviceTag) {
  const allowed = await getOperatorServiceTypeKeys(operatorId);
  if (!allowed.includes(serviceTag)) {
    throw new AppError('This customer type is not enabled for your account', 403, 'SERVICE_NOT_ALLOWED');
  }
}

async function resolveAccountPackageIds(operatorId, packageIds, connection) {
  const allowedIds = await getOperatorPackageIds(operatorId, { activeOnly: true, connection });

  if (!allowedIds.length) {
    throw new AppError('Operator has no packages assigned', 400, 'PACKAGE_NOT_ASSIGNED');
  }

  const requested = [...new Set((packageIds || []).map((id) => Number(id)).filter(Boolean))];

  if (allowedIds.length === 1) {
    const onlyId = allowedIds[0];
    if (requested.length && !requested.every((id) => id === onlyId)) {
      throw new AppError('Selected package is not assigned to this operator', 400, 'PACKAGE_NOT_ALLOWED');
    }
    return [onlyId];
  }

  if (!requested.length) {
    throw new AppError('Select at least one package before creating an account', 400, 'PACKAGE_REQUIRED');
  }

  const invalid = requested.filter((id) => !allowedIds.includes(id));
  if (invalid.length) {
    throw new AppError('Selected package is not assigned to this operator', 400, 'PACKAGE_NOT_ALLOWED');
  }

  return requested;
}

export async function getOperatorStats(operatorId) {
  const [operator] = await query(
    `SELECT o.id, o.client_name, o.package_id, o.package_type, o.service_scope, o.wallet_balance, o.accounts_created, o.is_active,
            o.wallet_commission_type, o.wallet_commission_value, o.wallet_self_topup_enabled,
            o.trial_account_limit, o.trial_accounts_used
     FROM operators o
     WHERE o.id = ? LIMIT 1`,
    [operatorId]
  );

  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  // Default customer type first. `serviceScope` keeps its old name for the frontend.
  const allowedServiceTags = await getOperatorServiceTypeKeys(operatorId);
  const serviceScope = allowedServiceTags;
  const allPackages = await getOperatorPackages(operatorId);
  const packages = allPackages.filter((pkg) =>
    allowedServiceTags.includes(pkg.service_tag || 'OTT')
  );
  const packageNames = packages.map((pkg) => pkg.name);
  const packageType = packageNames.length ? packageNames.join(', ') : operator.package_type;
  const walletBalance = Math.round(Number(operator.wallet_balance) * 100) / 100;

  const [statusCounts] = await query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN status = 'created' THEN 1 ELSE 0 END) AS created,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM voucher_accounts WHERE operator_id = ?`,
    [operatorId]
  );

  const statusBreakdown = await query(
    `SELECT status, COUNT(*) AS count
     FROM voucher_accounts
     WHERE operator_id = ?
     GROUP BY status`,
    [operatorId]
  );

  const activityRows = await query(
    `SELECT DATE(created_at) AS date, COUNT(*) AS count
     FROM voucher_accounts
     WHERE operator_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
     GROUP BY DATE(created_at)
     ORDER BY date ASC`,
    [operatorId]
  );

  const accountsCreated = Number(operator.accounts_created) || 0;

  const [periodCounts] = await query(
    `SELECT
       SUM(CASE WHEN DATE(created_at) = CURDATE() AND status = 'created' THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND status = 'created' THEN 1 ELSE 0 END) AS last7Days,
       SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) AND status = 'created' THEN 1 ELSE 0 END) AS last30Days
     FROM voucher_accounts
     WHERE operator_id = ?`,
    [operatorId]
  );

  const [walletSummaryRow] = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'topup' AND status = 'completed' THEN net_amount ELSE 0 END), 0) AS totalTopups,
       COALESCE(SUM(CASE WHEN ${operatorSpendDebitSql('')} THEN net_amount ELSE 0 END), 0) AS totalSpent,
       COALESCE(SUM(CASE WHEN type = 'topup' AND status = 'completed' THEN 1 ELSE 0 END), 0) AS topupCount,
       COALESCE(SUM(CASE WHEN ${operatorSpendDebitSql('')} THEN 1 ELSE 0 END), 0) AS debitCount
     FROM wallet_transactions
     WHERE operator_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)`,
    [operatorId]
  );

  const debitRows = await query(
    `SELECT net_amount, metadata
     FROM wallet_transactions
     WHERE operator_id = ? AND ${operatorSpendDebitSql('')}
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)`,
    [operatorId]
  );

  const chargeBreakdown = {
    createAccount: { count: 0, amount: 0 },
    customerTopup: { count: 0, amount: 0 },
    customerSubscribe: { count: 0, amount: 0 },
    bulkCreate: { count: 0, amount: 0 },
    other: { count: 0, amount: 0 },
  };

  for (const row of debitRows) {
    let activity = '';
    if (row.metadata) {
      try {
        const metadata = typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata);
        activity = metadata.activity || '';
      } catch {
        activity = '';
      }
    }
    const amount = Number(row.net_amount) || 0;
    if (activity === 'create_account') {
      chargeBreakdown.createAccount.count += 1;
      chargeBreakdown.createAccount.amount += amount;
    } else if (activity === 'customer_crm_topup' || activity === 'customer_topup') {
      chargeBreakdown.customerTopup.count += 1;
      chargeBreakdown.customerTopup.amount += amount;
    } else if (SUBSCRIBE_ACTIVITIES.includes(activity)) {
      chargeBreakdown.customerSubscribe.count += 1;
      chargeBreakdown.customerSubscribe.amount += amount;
    } else if (activity === 'bulk_create') {
      chargeBreakdown.bulkCreate.count += 1;
      chargeBreakdown.bulkCreate.amount += amount;
    } else {
      chargeBreakdown.other.count += 1;
      chargeBreakdown.other.amount += amount;
    }
  }

  for (const key of Object.keys(chargeBreakdown)) {
    chargeBreakdown[key].amount = Math.round(chargeBreakdown[key].amount * 100) / 100;
  }

  const recentTransactions = await query(
    `SELECT id, type, status, amount, net_amount, description, metadata, created_at
     FROM wallet_transactions
     WHERE operator_id = ?
     ORDER BY created_at DESC
     LIMIT 6`,
    [operatorId]
  );

  const recentAccounts = await query(
    `SELECT va.id, va.full_name, va.phone_number, va.status, va.amount_charged, va.created_at,
            GROUP_CONCAT(DISTINCT COALESCE(vap.package_name, p.name) ORDER BY COALESCE(vap.package_name, p.name) SEPARATOR ', ') AS package_names
     FROM voucher_accounts va
     LEFT JOIN voucher_account_packages vap ON vap.voucher_account_id = va.id
     LEFT JOIN packages p ON p.id = COALESCE(vap.package_id, va.package_id)
     WHERE va.operator_id = ?
     GROUP BY va.id, va.full_name, va.phone_number, va.status, va.amount_charged, va.created_at
     ORDER BY va.created_at DESC
     LIMIT 6`,
    [operatorId]
  );

  const packagePrices = packages.map((pkg) => Number(pkg.price_amount) || 0).filter((price) => price > 0);
  const minPackagePrice = packagePrices.length ? Math.min(...packagePrices) : 0;
  const trialQuota = getTrialQuotaInfo(operator.trial_account_limit, operator.trial_accounts_used);
  const lowBalance =
    minPackagePrice > 0 &&
    walletBalance < minPackagePrice &&
    trialQuota.trialAccountsRemaining <= 0;

  function mapRecentTransaction(row) {
    let metadata = {};
    if (row.metadata) {
      try {
        metadata = typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata);
      } catch {
        metadata = {};
      }
    }

    let activityLabel = 'Transaction';
    if (metadata.activity === 'create_account') activityLabel = 'Create Account';
    else if (metadata.activity === 'customer_crm_topup') activityLabel = 'Customer Top-up';
    else if (metadata.activity === 'customer_subscribe') activityLabel = 'Customer Subscribe';
    else if (metadata.activity === 'customer_renew') activityLabel = 'Customer Renewal';
    else if (metadata.activity === 'customer_upgrade') activityLabel = 'Customer Upgrade';
    else if (metadata.activity === 'customer_topup') activityLabel = 'Customer Top-up';
    else if (metadata.activity === 'bulk_create') activityLabel = 'Bulk Create';
    else if (metadata.activity === 'wallet_topup' || row.type === 'topup') activityLabel = 'Wallet Top-up';
    else if (row.type === 'debit') activityLabel = 'Wallet Charge';
    else if (row.type === 'adjustment') activityLabel = 'Adjustment';

    return {
      id: row.id,
      type: row.type,
      status: row.status,
      activity: activityLabel,
      amount: Math.round(Number(row.amount) * 100) / 100,
      netAmount: Math.round(Number(row.net_amount) * 100) / 100,
      description: row.description,
      customerName: metadata.customerName || null,
      createdAt: row.created_at,
    };
  }

  return {
    clientName: operator.client_name,
    serviceScope,
    allowedServiceTags,
    serviceTypes: listServiceTypesPublic().filter((type) => allowedServiceTags.includes(type.key)),
    packageType,
    packageNames,
    packages: packages.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      serviceTag: pkg.service_tag || 'OTT',
      priceAmount: Number(pkg.price_amount),
      currencyCode: pkg.currency_code,
    })),
    packageIds: packages.map((pkg) => pkg.id),
    walletBalance,
    currencyCode: config.wallet.currencyCode,
    walletCommissionType: operator.wallet_commission_type || 'none',
    walletCommissionValue: Number(operator.wallet_commission_value) || 0,
    canSelfTopup: Boolean(operator.wallet_self_topup_enabled),
    ...formatTrialForResponse(operator.trial_account_limit, operator.trial_accounts_used),
    accountsCreated,
    minPackagePrice,
    lowBalance,
    statusCounts,
    periodCounts: {
      today: Number(periodCounts?.today) || 0,
      last7Days: Number(periodCounts?.last7Days) || 0,
      last30Days: Number(periodCounts?.last30Days) || 0,
    },
    walletSummary: {
      totalTopups: Math.round(Number(walletSummaryRow?.totalTopups) * 100) / 100,
      totalSpent: Math.round(Number(walletSummaryRow?.totalSpent) * 100) / 100,
      topupCount: Number(walletSummaryRow?.topupCount) || 0,
      debitCount: Number(walletSummaryRow?.debitCount) || 0,
    },
    chargeBreakdown,
    recentTransactions: recentTransactions.map(mapRecentTransaction),
    recentAccounts: recentAccounts.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      phoneNumber: row.phone_number,
      status: row.status,
      amountCharged: Number(row.amount_charged) || 0,
      packageNames: row.package_names || '',
      createdAt: row.created_at,
    })),
    charts: {
      statusBreakdown: statusBreakdown.map((row) => ({
        status: row.status,
        count: Number(row.count) || 0,
      })),
      activityTrend: buildDailyTrend(activityRows, 30),
    },
  };
}

export function customerHistoryActivityLabel(activity) {
  switch (activity) {
    case 'customer_subscribe':
      return 'Subscribe';
    case 'bulk_create':
      return 'New account (bulk)';
    case 'customer_crm_topup':
    case 'customer_topup':
      return 'Top-up';
    case 'create_account':
    default:
      return 'New account';
  }
}

function activityFilterSql(activityFilter) {
  if (!activityFilter || activityFilter === 'all') {
    return { clause: null, params: [] };
  }
  if (activityFilter === 'new_account') {
    return {
      clause: `history.activity IN ('create_account', 'bulk_create')`,
      params: [],
    };
  }
  if (activityFilter === 'subscribe') {
    return {
      clause: `history.activity IN ('customer_subscribe', 'customer_renew', 'customer_upgrade')`,
      params: [],
    };
  }
  if (activityFilter === 'topup') {
    return {
      clause: `history.activity IN ('customer_crm_topup', 'customer_topup')`,
      params: [],
    };
  }
  return { clause: null, params: [] };
}

function buildCustomerHistoryQuery(operatorId, { search = '', startDate, endDate, activityFilter = 'all' } = {}) {
  const accountDateFilters = ['va.operator_id = ?'];
  const topupDateFilters = ['wt.operator_id = ?'];
  const accountParams = [operatorId];
  const topupParams = [operatorId];

  if (startDate) {
    accountDateFilters.push('va.created_at >= ?');
    topupDateFilters.push('COALESCE(wt.completed_at, wt.created_at) >= ?');
    const bound = `${startDate} 00:00:00`;
    accountParams.push(bound);
    topupParams.push(bound);
  }
  if (endDate) {
    accountDateFilters.push('va.created_at <= ?');
    topupDateFilters.push('COALESCE(wt.completed_at, wt.created_at) <= ?');
    const bound = `${endDate} 23:59:59`;
    accountParams.push(bound);
    topupParams.push(bound);
  }

  const params = [...accountParams, ...topupParams];

  const accountWhere = accountDateFilters.join(' AND ');
  const topupWhere = `${topupDateFilters.join(' AND ')}
    AND wt.type = 'debit'
    AND wt.status = 'completed'
    AND JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.activity')) IN ('customer_crm_topup', 'customer_topup')`;

  const unionSql = `
    SELECT * FROM (
      SELECT
        CONCAT('va-', va.id) AS history_id,
        va.created_at AS occurred_at,
        va.full_name AS customer_name,
        va.phone_number,
        va.service_tag,
        COALESCE(va.origin_activity, 'create_account') AS activity,
        va.status,
        GROUP_CONCAT(DISTINCT COALESCE(vap.package_name, p.name) ORDER BY COALESCE(vap.package_name, p.name) SEPARATOR ', ') AS package_names,
        va.amount_charged,
        va.external_ref,
        va.error_message,
        NULL AS wallet_reference
      FROM voucher_accounts va
      LEFT JOIN voucher_account_packages vap ON vap.voucher_account_id = va.id
      LEFT JOIN packages p ON p.id = COALESCE(vap.package_id, va.package_id)
      WHERE ${accountWhere}
      GROUP BY va.id, va.created_at, va.full_name, va.phone_number, va.service_tag, va.origin_activity,
               va.status, va.amount_charged, va.external_ref, va.error_message

      UNION ALL

      SELECT
        CONCAT('wt-', wt.id) AS history_id,
        COALESCE(wt.completed_at, wt.created_at) AS occurred_at,
        JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.customerName')) AS customer_name,
        JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.phoneNumber')) AS phone_number,
        JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.serviceTag')) AS service_tag,
        JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.activity')) AS activity,
        CASE COALESCE(JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.crmState')), 'completed')
          WHEN 'refunded' THEN 'failed'
          WHEN 'needs_reconciliation' THEN 'processing'
          WHEN 'pending' THEN 'processing'
          ELSE 'completed'
        END AS status,
        NULL AS package_names,
        CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.crmState')) = 'refunded' THEN 0
             ELSE wt.net_amount END AS amount_charged,
        wt.reference AS external_ref,
        CASE JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.crmState'))
          WHEN 'refunded' THEN 'CRM top-up failed — wallet refunded'
          WHEN 'needs_reconciliation' THEN 'Awaiting Medianet confirmation'
          ELSE NULL
        END AS error_message,
        wt.reference AS wallet_reference
      FROM wallet_transactions wt
      WHERE ${topupWhere}
    ) history
    WHERE 1=1`;

  const outerParams = [...params];
  const outerFilters = [];

  const { clause: activityClause, params: activityParams } = activityFilterSql(activityFilter);
  if (activityClause) {
    outerFilters.push(activityClause);
    outerParams.push(...activityParams);
  }

  if (search) {
    const term = `%${search}%`;
    outerFilters.push(`(
      history.customer_name LIKE ?
      OR history.phone_number LIKE ?
      OR history.status LIKE ?
      OR history.activity LIKE ?
      OR history.package_names LIKE ?
      OR history.external_ref LIKE ?
    )`);
    outerParams.push(term, term, term, term, term, term);
  }

  const outerWhere = outerFilters.length
    ? `${unionSql} AND ${outerFilters.join(' AND ')}`
    : unionSql;

  return { outerWhere, outerParams };
}

function mapCustomerHistoryRow(row) {
  const activity = row.activity || 'create_account';
  return {
    id: row.history_id,
    full_name: row.customer_name,
    phone_number: row.phone_number,
    service_tag: row.service_tag,
    activity,
    activity_label: customerHistoryActivityLabel(activity),
    status: row.status,
    package_names: row.package_names || '',
    amount_charged: row.amount_charged != null ? Number(row.amount_charged) : null,
    external_ref: row.external_ref,
    error_message: row.error_message,
    wallet_reference: row.wallet_reference,
    created_at: row.occurred_at,
  };
}

export async function listAccounts(
  operatorId,
  { page = 1, limit = 20, search = '', startDate, endDate, activity = 'all' } = {}
) {
  const { page: pageNum, limit: limitNum, clause } = paginationSql(page, limit);
  const { outerWhere, outerParams } = buildCustomerHistoryQuery(operatorId, {
    search,
    startDate,
    endDate,
    activityFilter: activity,
  });

  const rows = await query(
    `${outerWhere}
     ORDER BY history.occurred_at DESC
     ${clause}`,
    outerParams
  );

  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM (${outerWhere}) counted`,
    outerParams
  );

  const total = Number(countRow.total) || 0;
  const accounts = rows.map(mapCustomerHistoryRow);

  return {
    accounts,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
  };
}


export async function exportAccountsCsv(
  operatorId,
  { search = '', startDate, endDate, activity = 'all' } = {}
) {
  const { outerWhere, outerParams } = buildCustomerHistoryQuery(operatorId, {
    search,
    startDate,
    endDate,
    activityFilter: activity,
  });

  const [operator] = await query(
    `SELECT client_name, email FROM operators WHERE id = ? LIMIT 1`,
    [operatorId]
  );

  const rows = await query(
    `${outerWhere}
     ORDER BY history.occurred_at DESC
     LIMIT 10000`,
    outerParams
  );

  const accounts = rows.map(mapCustomerHistoryRow);

  const lines = [
    'Medianet Voucher — Customer History',
    csvRow(['Generated', new Date().toISOString()]),
    csvRow(['Operator', operator?.client_name || '']),
    csvRow(['Email', operator?.email || '']),
    csvRow(['Start date', startDate || 'All']),
    csvRow(['End date', endDate || 'All']),
    csvRow(['Activity filter', activity && activity !== 'all' ? activity : 'All']),
    csvRow(['Search filter', search || 'All']),
    csvRow(['Total records', accounts.length]),
    '',
    [
      'Date',
      'Activity',
      'Customer Name',
      'Phone Number',
      'Service',
      'Package(s)',
      'Status',
      'Amount Charged (MVR)',
      'Reference',
      'Error Message',
    ].join(','),
  ];

  for (const row of accounts) {
    lines.push(
      [
        row.created_at ? new Date(row.created_at).toISOString() : '',
        row.activity_label,
        row.full_name,
        row.phone_number,
        row.service_tag || '',
        row.package_names || '',
        row.status,
        row.amount_charged ?? '',
        row.external_ref || row.wallet_reference || '',
        row.error_message || '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  return `\ufeff${lines.join('\n')}`;
}

/*
 * Money-safe CRM provisioning ("reserve first"):
 *   1. Short locked transaction: create the voucher row and take payment up front
 *      (trial slot, wallet debit, or free) with a unique reference. Commit.
 *   2. Call CRM outside any transaction, sending that reference as the payment backoffice_code.
 *   3. Settle: success → mark created; nothing posted in CRM → release the charge;
 *      CRM payment posted or outcome unknown → keep the charge and flag for reconciliation.
 * A crash between steps leaves the row `processing` with the charge kept (never free service).
 */

const RECONCILIATION_MESSAGE =
  'Payment was sent to CRM but activation did not complete. Your wallet charge is on hold — Medianet support will complete or refund it.';

async function lockActiveOperator(connection, operatorId) {
  const [rows] = await connection.execute(
    `SELECT id, wallet_balance, accounts_created, is_active, client_name, service_scope,
            trial_account_limit, trial_accounts_used
     FROM operators WHERE id = ? FOR UPDATE`,
    [operatorId]
  );
  const operator = rows[0];
  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }
  if (!operator.is_active) {
    throw new AppError('Operator account is inactive', 403, 'FORBIDDEN');
  }
  return operator;
}

/** Phase 1 — must run inside a transaction that already holds the operator row lock. */
async function reserveVoucherAccounts(
  connection,
  {
    operatorId,
    operator,
    accounts,
    packageIds,
    pricing,
    serviceTag,
    activity,
    metadataExtra = {},
    allowTrial = true,
  }
) {
  const unitCost = roundMoney(pricing.total);
  const packageNames = pricing.packages.map((pkg) => pkg.name);
  const walletBalance = roundMoney(operator.wallet_balance);
  const trialQuota = allowTrial
    ? getTrialQuotaInfo(operator.trial_account_limit, operator.trial_accounts_used)
    : getTrialQuotaInfo(0, 0);
  const paidCount = unitCost > 0 ? countPaidAccountCreations(accounts.length, trialQuota.trialAccountsRemaining) : 0;
  const requiredBalance = roundMoney(unitCost * paidCount);

  if (walletBalance < requiredBalance) {
    throw new AppError(
      `Insufficient wallet balance. Required ${requiredBalance} ${pricing.currencyCode}, available ${walletBalance} ${pricing.currencyCode}.`,
      403,
      'INSUFFICIENT_WALLET_BALANCE'
    );
  }

  let trialRemaining = trialQuota.trialAccountsRemaining;
  const reservations = [];

  for (const account of accounts) {
    const fullName = account.fullName.trim();
    const phoneNumber = account.phoneNumber.trim();

    const [insertResult] = await connection.execute(
      `INSERT INTO voucher_accounts (operator_id, package_id, full_name, phone_number, service_tag, origin_activity, status)
       VALUES (?, ?, ?, ?, ?, ?, 'processing')`,
      [operatorId, packageIds[0], fullName, phoneNumber, serviceTag, activity]
    );
    const voucherAccountId = insertResult.insertId;

    // Snapshot each package as sold (name, list price, CRM ids, sales model) so later edits
    // to the package never change this account's history or any report built from it.
    for (const packageId of packageIds) {
      const priced = pricing.packages.find((pkg) => Number(pkg.id) === Number(packageId));
      await connection.execute(
        `INSERT INTO voucher_account_packages
           (voucher_account_id, package_id, package_name, price_amount, currency_code,
            product_id, price_term_id, sales_model_name, service_tag)
         SELECT ?, p.id, COALESCE(?, p.name), COALESCE(?, p.price_amount), COALESCE(?, p.currency_code),
                p.product_id, p.price_term_id, sm.name, p.service_tag
         FROM packages p
         LEFT JOIN sales_models sm ON sm.id = p.sales_model_id
         WHERE p.id = ?`,
        [
          voucherAccountId,
          priced?.name ?? null,
          priced?.priceAmount ?? null,
          priced?.currencyCode ?? null,
          packageId,
        ]
      );
    }

    let chargeType;
    let amountCharged = 0;
    let paymentReference;

    if (trialRemaining > 0) {
      trialRemaining -= 1;
      chargeType = 'trial';
      paymentReference = generateReference('TRL');
      await connection.execute(
        `UPDATE operators
         SET trial_accounts_used = trial_accounts_used + 1,
             accounts_created = accounts_created + 1
         WHERE id = ?`,
        [operatorId]
      );
    } else if (unitCost > 0) {
      chargeType = 'wallet';
      amountCharged = unitCost;
      const debit = await debitWallet(connection, {
        operatorId,
        amount: unitCost,
        voucherAccountId,
        description: buildChargeDescription(activity, fullName, phoneNumber, packageNames),
        createdByType: 'operator',
        createdById: operatorId,
        metadata: {
          ...metadataExtra,
          activity,
          packageIds,
          packageNames,
          phoneNumber,
          customerName: fullName,
          serviceTag,
          crmState: 'pending',
        },
      });
      paymentReference = debit.reference;
      await connection.execute(
        `UPDATE operators SET accounts_created = accounts_created + 1 WHERE id = ?`,
        [operatorId]
      );
    } else {
      chargeType = 'free';
      paymentReference = generateReference('FRE');
      await connection.execute(
        `UPDATE operators SET accounts_created = accounts_created + 1 WHERE id = ?`,
        [operatorId]
      );
    }

    await connection.execute(
      `UPDATE voucher_accounts SET amount_charged = ? WHERE id = ?`,
      [amountCharged, voucherAccountId]
    );

    reservations.push({
      voucherAccountId,
      fullName,
      phoneNumber,
      chargeType,
      amountCharged,
      paymentReference,
    });
  }

  return reservations;
}

async function markReservationCreated(reservation, crmResult, fallbackRef = null) {
  const externalRef = crmResult?.subscriptionId || crmResult?.contactId || fallbackRef || null;
  await query(
    `UPDATE voucher_accounts
     SET status = 'created', external_ref = ?, error_message = NULL
     WHERE id = ? AND status = 'processing'`,
    [externalRef, reservation.voucherAccountId]
  );
  if (reservation.chargeType === 'wallet') {
    await mergeTransactionMetadata(null, reservation.paymentReference, {
      crmState: 'completed',
      crmPaymentId: crmResult?.paymentId || null,
      crmSubscriptionId: crmResult?.subscriptionId || null,
    });
  }
  return externalRef;
}

/** Nothing was posted in CRM: return the wallet debit / trial slot and mark the row failed. */
async function releaseReservation(operatorId, reservation, errorMessage) {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`SELECT id FROM operators WHERE id = ? FOR UPDATE`, [operatorId]);

    const [rows] = await connection.execute(
      `SELECT status FROM voucher_accounts WHERE id = ? FOR UPDATE`,
      [reservation.voucherAccountId]
    );
    if (rows[0]?.status !== 'processing') {
      await connection.commit();
      return;
    }

    if (reservation.chargeType === 'wallet') {
      await refundWalletDebit(connection, {
        operatorId,
        debitReference: reservation.paymentReference,
        amount: reservation.amountCharged,
        voucherAccountId: reservation.voucherAccountId,
        description: `Refund — activation failed for ${reservation.fullName} (${reservation.phoneNumber})`,
        reason: errorMessage,
      });
    }

    await connection.execute(
      `UPDATE operators
       SET accounts_created = GREATEST(accounts_created - 1, 0),
           trial_accounts_used = GREATEST(trial_accounts_used - ?, 0)
       WHERE id = ?`,
      [reservation.chargeType === 'trial' ? 1 : 0, operatorId]
    );
    await connection.execute(
      `UPDATE voucher_accounts
       SET status = 'failed', amount_charged = 0, error_message = ?
       WHERE id = ?`,
      [String(errorMessage).slice(0, 1000), reservation.voucherAccountId]
    );

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/** CRM payment posted (or may have): keep the charge and flag for staff reconciliation. */
async function flagReservationForReconciliation(operatorId, reservation, err, outcome, reqMeta, context) {
  const detail = err?.details || {};
  await query(
    `UPDATE voucher_accounts SET status = 'failed', error_message = ? WHERE id = ? AND status = 'processing'`,
    [`${RECONCILIATION_MESSAGE} (${String(err?.message || '').slice(0, 400)})`, reservation.voucherAccountId]
  );
  if (reservation.chargeType === 'wallet') {
    await mergeTransactionMetadata(null, reservation.paymentReference, {
      crmState: 'needs_reconciliation',
      crmOutcome: outcome,
      crmPaymentId: detail.paymentId || null,
      crmContactId: detail.contactId || context.crmContactId || null,
      crmSubscriptionId: detail.subscriptionId || null,
    });
  }
  await logAudit({
    actorType: 'operator',
    actorId: operatorId,
    action: 'CRM_RECONCILIATION_REQUIRED',
    resourceType: 'voucher_account',
    resourceId: reservation.voucherAccountId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: {
      outcome,
      activity: context.activity,
      paymentReference: reservation.paymentReference,
      chargeType: reservation.chargeType,
      amountCharged: reservation.amountCharged,
      crmPaymentId: detail.paymentId || null,
      crmContactId: detail.contactId || context.crmContactId || null,
      error: String(err?.message || '').slice(0, 500),
    },
  });
}

/** Phase 2 + 3 for one reservation. Never throws; returns the per-account outcome. */
async function provisionReservation(operatorId, reservation, runCrm, reqMeta, context) {
  try {
    const crmResult = await runCrm(reservation.paymentReference);
    let externalRef = null;
    try {
      externalRef = await markReservationCreated(reservation, crmResult, context.crmContactId);
    } catch (dbErr) {
      console.error('[Provision] CRM succeeded but local update failed:', reservation.voucherAccountId, dbErr.message);
    }
    return { status: 'created', externalRef, amountCharged: reservation.amountCharged };
  } catch (err) {
    const outcome = classifyCrmFailure(err);
    const message = err?.message || 'Activation failed';
    try {
      if (outcome === 'not_charged') {
        await releaseReservation(operatorId, reservation, message);
        return {
          status: 'failed',
          amountCharged: 0,
          errorMessage: message,
          errorCode: err?.code || 'CRM_PROVISION_FAILED',
          errorStatus: err instanceof AppError && err.statusCode < 500 ? err.statusCode : 502,
        };
      }
      await flagReservationForReconciliation(operatorId, reservation, err, outcome, reqMeta, context);
    } catch (settleErr) {
      console.error('[Provision] Settlement failed; left for reconciliation:', reservation.voucherAccountId, settleErr.message);
    }
    return {
      status: 'failed',
      amountCharged: reservation.amountCharged,
      errorMessage: RECONCILIATION_MESSAGE,
      errorCode: 'CRM_RECONCILIATION_REQUIRED',
      errorStatus: 502,
    };
  }
}

async function readWalletBalance(operatorId) {
  const [row] = await query(`SELECT wallet_balance FROM operators WHERE id = ? LIMIT 1`, [operatorId]);
  return roundMoney(row?.wallet_balance);
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function resolveActivatePackageIds(operatorId, packageIds, serviceTag, connection) {
  assertServiceTag(serviceTag);
  const allowedPackages = await getOperatorPackages(operatorId, { connection });
  const allowedIds = allowedPackages
    .filter((pkg) => pkg.is_active && (pkg.service_tag || 'OTT') === serviceTag)
    .map((pkg) => pkg.id);

  if (!allowedIds.length) {
    throw new AppError(`Operator has no ${serviceTag} packages assigned`, 400, 'PACKAGE_NOT_ASSIGNED');
  }

  const requested = [...new Set((packageIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!requested.length) {
    if (allowedIds.length === 1) {
      return allowedIds;
    }
    throw new AppError('Select at least one package', 400, 'PACKAGE_REQUIRED');
  }

  const invalid = requested.filter((id) => !allowedIds.includes(id));
  if (invalid.length) {
    throw new AppError('Selected package is not assigned to this operator', 400, 'PACKAGE_NOT_ALLOWED');
  }

  return requested;
}

/** Search by phone number, or by the service code on the customer's device (`{ phone }` or `{ code }`). */
export async function searchCustomers(operatorId, { phone, code }, serviceTag = 'OTT') {
  const [operator] = await query(
    `SELECT id, is_active, service_scope FROM operators WHERE id = ? LIMIT 1`,
    [operatorId]
  );
  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }
  if (!operator.is_active) {
    throw new AppError('Operator account is inactive', 403, 'FORBIDDEN');
  }

  await assertOperatorServiceTag(operatorId, serviceTag);
  const [result, eligibility] = await Promise.all([
    withCrmReadSlot(operatorId, () =>
      code
        ? crmService.searchCustomersByServiceCode(code, serviceTag)
        : crmService.searchCustomersByPhone(phone, serviceTag)
    ),
    loadEligibilityContext(operatorId, serviceTag),
  ]);

  // What each customer can be sold: continue, upgrade, add, or not available with a reason.
  // Null when the customer's services could not be read, because nothing can be decided then.
  for (const customer of result.customers || []) {
    customer.packageOptions =
      customer.services == null
        ? null
        : evaluatePackageOptions({ ...eligibility, services: customer.services });
  }

  // An upgrade is priced by CRM (new package less credit for the unused days), so each one
  // is estimated now. When CRM will not change the service in place, the upgrade is still
  // offered as a replacement: full price, old package cancelled, new one started.
  const upgrades = (result.customers || []).flatMap((customer) =>
    (customer.packageOptions || [])
      .filter((option) => option.action === 'upgrade')
      .map((option) => ({ customer, option }))
  );
  await Promise.all(
    upgrades.map(async ({ customer, option }) => {
      let estimate;
      try {
        estimate = await withCrmReadSlot(operatorId, () =>
          crmService.estimateServiceChange(customer.id, option, option.packageId)
        );
      } catch {
        // CRM did not answer, so it is not known which kind of upgrade this is.
        Object.assign(option, {
          eligible: false,
          action: null,
          reason: 'CRM could not price this upgrade. Search again to retry.',
        });
        return;
      }
      if (estimate.allowed) {
        option.upgradeMode = 'change';
        option.charge = { amount: estimate.amount, newCharge: estimate.newCharge, credit: estimate.credit };
      } else {
        option.upgradeMode = 'replace';
        option.replaceReason = estimate.reason;
      }
    })
  );
  return result;
}

export async function crmTopupCustomer(operatorId, data, reqMeta = {}) {
  return withCrmSlot(operatorId, () => crmTopupCustomerInner(operatorId, data, reqMeta));
}

async function crmTopupCustomerInner(operatorId, data, reqMeta) {
  const amount = roundMoney(data.amount);

  const [operatorPreview] = await query(
    `SELECT id, is_active, service_scope FROM operators WHERE id = ? LIMIT 1`,
    [operatorId]
  );
  if (!operatorPreview) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }
  if (!operatorPreview.is_active) {
    throw new AppError('Operator account is inactive', 403, 'FORBIDDEN');
  }
  await assertOperatorServiceTag(operatorId, data.serviceTag);

  const binding = await resolveCustomerBinding(data);
  const { phoneNumber } = binding;
  const fullName = String(data.fullName || binding.customer.name || 'Customer').trim();

  // Phase 1: take the money under the operator lock before anything is posted to CRM.
  let debit;
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    const operator = await lockActiveOperator(connection, operatorId);
    await assertOperatorServiceTag(operatorId, data.serviceTag);

    debit = await debitWallet(connection, {
      operatorId,
      amount,
      description: buildChargeDescription('customer_crm_topup', fullName, phoneNumber),
      createdByType: 'operator',
      createdById: operatorId,
      metadata: {
        activity: 'customer_crm_topup',
        phoneNumber,
        customerName: fullName,
        serviceTag: data.serviceTag,
        crmContactId: data.crmContactId,
        topupAmount: amount,
        crmState: 'pending',
        ...channelMetadata(reqMeta),
      },
    });
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  // Phase 2: one CRM payment per wallet debit, tagged with the debit reference.
  let crmResult;
  try {
    crmResult = await crmService.postCustomerPayment(data.crmContactId, amount, {
      paymentReference: debit.reference,
    });
  } catch (err) {
    const outcome = classifyCrmFailure(err);
    if (outcome === 'not_charged') {
      await refundTopupDebit(operatorId, debit, fullName, phoneNumber, err.message);
      if (err instanceof AppError && err.statusCode < 500) throw err;
      throw new AppError(err.message || 'CRM top-up failed. Your wallet was not charged.', 502, err.code || 'CRM_ERROR');
    }

    await mergeTransactionMetadata(null, debit.reference, {
      crmState: 'needs_reconciliation',
      crmOutcome: outcome,
    }).catch((mergeErr) => console.error('[CRM topup] metadata update failed:', mergeErr.message));
    await logAudit({
      actorType: 'operator',
      actorId: operatorId,
      action: 'CRM_RECONCILIATION_REQUIRED',
      resourceType: 'wallet_transaction',
      resourceId: debit.transactionId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: {
        outcome,
        activity: 'customer_crm_topup',
        paymentReference: debit.reference,
        crmContactId: data.crmContactId,
        amount,
        error: String(err?.message || '').slice(0, 500),
      },
    });
    throw new AppError(RECONCILIATION_MESSAGE, 502, 'CRM_RECONCILIATION_REQUIRED');
  }

  // Phase 3: finalize.
  await mergeTransactionMetadata(null, debit.reference, {
    crmState: 'completed',
    crmPaymentId: crmResult.paymentId,
  }).catch((mergeErr) => console.error('[CRM topup] metadata update failed:', mergeErr.message));

  await logAudit({
    actorType: 'operator',
    actorId: operatorId,
    action: 'CUSTOMER_CRM_TOPUP',
    resourceType: 'wallet_transaction',
    resourceId: debit.transactionId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: {
      crmContactId: data.crmContactId,
      amount,
      serviceTag: data.serviceTag,
      phoneNumber,
      crmPaymentId: crmResult.paymentId,
      paymentReference: debit.reference,
      ...channelMetadata(reqMeta),
    },
  });

  const walletBalance = await readWalletBalance(operatorId);
  return {
    crmContactId: data.crmContactId,
    fullName,
    phoneNumber,
    serviceTag: data.serviceTag,
    amountCharged: amount,
    crmPaymentId: crmResult.paymentId,
    reference: debit.reference,
    walletBalance,
    currencyCode: 'MVR',
    balanceBefore: debit.balanceBefore,
    balanceAfter: debit.balanceAfter,
  };
}

async function refundTopupDebit(operatorId, debit, fullName, phoneNumber, reason) {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    await refundWalletDebit(connection, {
      operatorId,
      debitReference: debit.reference,
      amount: debit.debit,
      description: `Refund — CRM top-up failed for ${fullName} (${phoneNumber})`,
      reason,
    });
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    console.error('[CRM topup] Refund failed; left for reconciliation:', debit.reference, err.message);
    await mergeTransactionMetadata(null, debit.reference, { crmState: 'needs_reconciliation', crmOutcome: 'refund_failed' }).catch(() => {});
  } finally {
    connection.release();
  }
}

/**
 * Confirms the CRM contact the operator is about to charge for really is the one a lookup
 * returns, by the same key the operator searched with (service code or phone number).
 * Returns the phone number to record with the sale.
 */
async function resolveCustomerBinding(
  { crmContactId, phoneNumber, serviceCode, serviceTag, deviceId },
  { requireDevice = false } = {}
) {
  const lookup = serviceCode
    ? await crmService.searchCustomersByServiceCode(serviceCode, serviceTag)
    : await crmService.searchCustomersByPhone(phoneNumber, serviceTag);
  // One entry per device of the customer.
  const entries = (lookup.customers || []).filter(
    (customer) => String(customer.id) === String(crmContactId)
  );
  let match = entries[0];
  if (requireDevice && match) {
    if (deviceId) {
      match = entries.find((customer) => customer.deviceId === deviceId);
      if (!match) {
        throw new AppError('This device does not belong to the customer', 400, 'VALIDATION_ERROR');
      }
    } else if (entries.length > 1) {
      throw new AppError(
        'This customer has more than one device. Choose the device to sell to.',
        400,
        'DEVICE_REQUIRED'
      );
    }
  }
  if (!match) {
    throw new AppError(
      serviceCode
        ? 'Customer reference does not match a service code lookup for this service'
        : 'Customer reference does not match a phone lookup for this service',
      400,
      'VALIDATION_ERROR'
    );
  }

  const crmPhone = String(match.phone || '').replace(/\D/g, '').slice(-7);
  return { phoneNumber: String(phoneNumber || '').trim() || crmPhone || '', customer: match };
}

export async function subscribeCustomer(operatorId, data, reqMeta = {}) {
  return withCrmSlot(operatorId, () => subscribeCustomerInner(operatorId, data, reqMeta));
}

async function subscribeCustomerInner(operatorId, rawData, reqMeta) {
  const binding = await resolveCustomerBinding(rawData, { requireDevice: true });
  const data = {
    ...rawData,
    phoneNumber: binding.phoneNumber,
    fullName: String(rawData.fullName || binding.customer.name || 'Customer').trim(),
  };
  // A package is sold to one device; its services are what the rules below look at.
  const deviceId = binding.customer.deviceId || null;

  // Decide what this purchase is (new package, renewal or upgrade) from what the customer
  // already has. The rules are re-checked here, so a client cannot skip them.
  if (binding.customer.services == null) {
    throw new AppError(
      'Could not read the customer\'s current services from CRM. Please try again.',
      502,
      'CRM_ERROR'
    );
  }
  const eligibility = await loadEligibilityContext(operatorId, data.serviceTag);
  // "Renew everything": every package on this device that this operator sells.
  if (data.renewAll) {
    data.packageIds = evaluatePackageOptions({ ...eligibility, services: binding.customer.services })
      .filter((item) => item.action === 'renew')
      .map((item) => item.packageId);
    if (!data.packageIds.length) {
      throw new AppError('This device has no package that can be renewed', 400, 'NOTHING_TO_RENEW');
    }
  }
  const purchase = resolvePurchase(
    { ...eligibility, services: binding.customer.services, packageIds: data.packageIds },
    (message) => {
      throw new AppError(message, 400, 'PACKAGE_NOT_ELIGIBLE');
    }
  );
  // The partner API has one endpoint per kind of purchase and says which one it means.
  if (data.expectedAction && data.expectedAction !== purchase.action) {
    const kind = { subscribe: 'a new subscription', renew: 'a renewal', upgrade: 'an upgrade' };
    throw new AppError(
      `For this customer this purchase is ${kind[purchase.action]}, not ${kind[data.expectedAction]}.`,
      409,
      'ACTION_MISMATCH'
    );
  }
  const activity = PURCHASE_ACTIVITY[purchase.action];
  const option = purchase.options[0];

  // An upgrade costs what CRM says it costs right now: the new package for the days left in
  // the term, less credit for the old one. Asked again here so the charge is never stale.
  // When CRM will not change the service in place, the upgrade is done as a replacement
  // instead: full price, old package cancelled, new one started.
  let upgradeEstimate = null;
  let upgradeMode = null;
  if (purchase.action === 'upgrade') {
    const estimate = await crmService.estimateServiceChange(data.crmContactId, option, option.packageId);
    upgradeMode = estimate.allowed ? 'change' : 'replace';
    if (estimate.allowed) upgradeEstimate = estimate;
  }

  let reservation;
  let resolvedPackageIds;
  let pricing;
  let balanceBefore;
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    const operator = await lockActiveOperator(connection, operatorId);
    await assertOperatorServiceTag(operatorId, data.serviceTag);

    resolvedPackageIds = await resolveActivatePackageIds(
      operatorId,
      data.packageIds,
      data.serviceTag,
      connection
    );
    pricing = await sumPackagePrices(resolvedPackageIds, { connection });
    if (upgradeEstimate) {
      // Packages keep their list price in the sale record; the charge is the CRM estimate.
      pricing = { ...pricing, listTotal: pricing.total, total: upgradeEstimate.amount };
    }

    // The portal always sends the amount it showed; API callers may leave it out to accept
    // the current price.
    if (data.amount != null && !amountsMatch(pricing.total, data.amount)) {
      throw new AppError(
        upgradeEstimate
          ? `The upgrade price is now ${pricing.total} ${pricing.currencyCode}. Search the customer again to refresh it.`
          : `Amount must exactly match the selected package total (${pricing.total} ${pricing.currencyCode}).`,
        400,
        'AMOUNT_MISMATCH'
      );
    }

    balanceBefore = roundMoney(operator.wallet_balance);
    [reservation] = await reserveVoucherAccounts(connection, {
      operatorId,
      operator,
      accounts: [{ fullName: data.fullName, phoneNumber: data.phoneNumber }],
      packageIds: resolvedPackageIds,
      pricing,
      serviceTag: data.serviceTag,
      activity,
      // Free-account slots are for new packages; renewals and upgrades are always paid.
      allowTrial: purchase.action === 'subscribe',
      metadataExtra: {
        ...channelMetadata(reqMeta),
        crmContactId: data.crmContactId,
        crmDeviceId: deviceId,
        serviceCode: binding.customer.deviceCode || null,
        purchaseAction: purchase.action,
        ...(purchase.action === 'subscribe'
          ? {}
          : {
              crmServiceIds: purchase.options.map((item) => item.serviceId),
              replacedPackage: option.replaces?.name || null,
              cancelledAddons: option.cancels.map((item) => item.name),
            }),
        ...(upgradeMode ? { upgradeMode } : {}),
        ...(upgradeEstimate
          ? { listPrice: pricing.listTotal, crmNewCharge: upgradeEstimate.newCharge, crmCredit: upgradeEstimate.credit }
          : {}),
      },
    });
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  const outcome = await provisionReservation(
    operatorId,
    reservation,
    (paymentReference) => {
      if (purchase.action === 'renew') {
        return crmService.renewServicesForContact(
          data.crmContactId,
          purchase.options.map((item) => ({ serviceId: item.serviceId, packageId: item.packageId })),
          { paymentReference }
        );
      }
      if (upgradeMode === 'replace') {
        return crmService.replaceServiceForContact(
          data.crmContactId,
          { serviceId: option.serviceId, cancelServiceIds: option.cancels.map((item) => item.serviceId) },
          option.packageId,
          { paymentReference, deviceId }
        );
      }
      if (purchase.action === 'upgrade') {
        return crmService.upgradeServiceForContact(
          data.crmContactId,
          { serviceId: option.serviceId, cancelServiceIds: option.cancels.map((item) => item.serviceId) },
          option.packageId,
          { paymentReference, amount: upgradeEstimate.amount, deviceId }
        );
      }
      return crmService.activatePackagesForContact(data.crmContactId, resolvedPackageIds, {
        paymentReference,
        deviceId,
      });
    },
    reqMeta,
    { activity, crmContactId: data.crmContactId }
  );

  if (outcome.status !== 'created') {
    throw new AppError(outcome.errorMessage, outcome.errorStatus, outcome.errorCode);
  }

  await logAudit({
    actorType: 'operator',
    actorId: operatorId,
    action: purchase.action === 'renew' ? 'CUSTOMER_RENEW' : purchase.action === 'upgrade' ? 'CUSTOMER_UPGRADE' : 'CUSTOMER_SUBSCRIBE',
    resourceType: 'voucher_account',
    resourceId: reservation.voucherAccountId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: {
      crmContactId: data.crmContactId,
      packageIds: resolvedPackageIds,
      unitCost: pricing.total,
      serviceTag: data.serviceTag,
      phoneNumber: reservation.phoneNumber,
      paymentReference: reservation.paymentReference,
      ...channelMetadata(reqMeta),
      purchaseAction: purchase.action,
      crmServiceIds: purchase.options.map((item) => item.serviceId).filter(Boolean),
      replacedPackage: option.replaces?.name || null,
      cancelledAddons: option.cancels.map((item) => item.name),
    },
  });

  const walletBalance = await readWalletBalance(operatorId);
  return {
    action: purchase.action,
    upgradeMode,
    reference: reservation.paymentReference,
    chargeType: reservation.chargeType,
    crmContactId: data.crmContactId,
    deviceId,
    serviceCode: binding.customer.deviceCode || null,
    listPrice: pricing.listTotal ?? pricing.total,
    creditApplied: upgradeEstimate?.credit ?? 0,
    replacedPackage: option.replaces?.name || null,
    cancelledAddons: option.cancels.map((item) => item.name),
    id: reservation.voucherAccountId,
    fullName: reservation.fullName,
    phoneNumber: reservation.phoneNumber,
    serviceTag: data.serviceTag,
    packageIds: resolvedPackageIds,
    packageNames: pricing.packages.map((pkg) => pkg.name),
    amountCharged: outcome.amountCharged,
    status: 'created',
    externalRef: outcome.externalRef || null,
    walletBalance,
    unitCost: pricing.total,
    currencyCode: pricing.currencyCode,
    balanceBefore,
    balanceAfter: walletBalance,
  };
}

async function assertPackagesMatchServiceTag(packageIds, serviceTag, connection) {
  const plans = await assertPackagesAssignable(packageIds);
  for (const plan of plans) {
    if ((plan.serviceTag || 'OTT') !== serviceTag) {
      throw new AppError(
        'Selected packages do not match the chosen customer type',
        400,
        'PACKAGE_TAG_MISMATCH'
      );
    }
  }
  return sumPackagePrices(packageIds, { connection });
}

function amountsMatch(expected, provided) {
  return Math.round(Number(expected) * 100) === Math.round(Number(provided) * 100);
}

const WALLET_TX_DESCRIPTION_MAX = 500;

function buildChargeDescription(activity, customerName, phoneNumber, packageNames = []) {
  const packagesLabel = packageNames.length ? packageNames.join(', ') : 'package';
  const customerLabel = `${customerName} (${phoneNumber})`;

  let description;
  if (activity === 'customer_crm_topup') {
    description = `Customer wallet top-up for ${customerLabel}`;
  } else if (activity === 'customer_subscribe') {
    description = `Customer subscribe — ${packagesLabel} for ${customerLabel}`;
  } else if (activity === 'customer_renew') {
    description = `Customer renewal — ${packagesLabel} for ${customerLabel}`;
  } else if (activity === 'customer_upgrade') {
    description = `Customer upgrade — ${packagesLabel} for ${customerLabel}`;
  } else if (activity === 'customer_topup') {
    description = `Customer top-up — ${packagesLabel} for ${customerLabel}`;
  } else if (activity === 'bulk_create') {
    description = `Bulk create — ${packagesLabel} for ${customerLabel}`;
  } else {
    description = `Create account — ${packagesLabel} for ${customerLabel}`;
  }

  if (description.length > WALLET_TX_DESCRIPTION_MAX) {
    return `${description.slice(0, WALLET_TX_DESCRIPTION_MAX - 1)}…`;
  }
  return description;
}

/** Reserve all accounts in one locked transaction, then provision each in CRM sequentially. */
async function createAndProvisionAccounts(operatorId, accounts, packageIds, pricing, serviceTag, activity, reqMeta) {
  let reservations;
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    const operator = await lockActiveOperator(connection, operatorId);
    await assertOperatorServiceTag(operatorId, serviceTag);
    reservations = await reserveVoucherAccounts(connection, {
      operatorId,
      operator,
      accounts,
      packageIds,
      pricing,
      serviceTag,
      activity,
    });
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  const results = [];
  for (const reservation of reservations) {
    const outcome = await provisionReservation(
      operatorId,
      reservation,
      (paymentReference) =>
        crmService.provisionOttAccount(reservation.phoneNumber, reservation.fullName, packageIds, {
          paymentReference,
        }),
      reqMeta,
      { activity }
    );
    results.push({
      id: reservation.voucherAccountId,
      fullName: reservation.fullName,
      phoneNumber: reservation.phoneNumber,
      packageIds,
      amountCharged: outcome.amountCharged,
      trialFree: reservation.chargeType === 'trial' && outcome.status === 'created',
      status: outcome.status,
      externalRef: outcome.externalRef || null,
      errorMessage: outcome.errorMessage || null,
      errorCode: outcome.errorCode || null,
      errorStatus: outcome.errorStatus || null,
    });
  }
  return results;
}

/** Package + scope validation that does not need the operator lock. */
async function resolveCreationPricing(operatorId, requestedPackageIds, serviceTag) {
  const [operator] = await query(
    `SELECT id, is_active, service_scope FROM operators WHERE id = ? LIMIT 1`,
    [operatorId]
  );
  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }
  if (!operator.is_active) {
    throw new AppError('Operator account is inactive', 403, 'FORBIDDEN');
  }

  const packageIds = await resolveAccountPackageIds(operatorId, requestedPackageIds, null);
  let resolvedTag = serviceTag;
  if (!resolvedTag) {
    const plans = await assertPackagesAssignable(packageIds);
    resolvedTag = plans[0]?.serviceTag || 'OTT';
  }
  await assertOperatorServiceTag(operatorId, resolvedTag);
  const pricing = await assertPackagesMatchServiceTag(packageIds, resolvedTag, null);
  return { packageIds, pricing, serviceTag: resolvedTag };
}

/** @deprecated use subscribeCustomer */
export async function activateCustomer(operatorId, data, reqMeta = {}) {
  return subscribeCustomer(operatorId, data, reqMeta);
}

export async function topupCustomer(operatorId, data, reqMeta = {}) {
  return crmTopupCustomer(operatorId, data, reqMeta);
}

export async function createSingleAccount(operatorId, account, reqMeta = {}) {
  return withCrmSlot(operatorId, () => createSingleAccountInner(operatorId, account, reqMeta));
}

async function createSingleAccountInner(operatorId, account, reqMeta) {
  const requestedTag = assertServiceTag(account.serviceTag);
  const { packageIds, pricing, serviceTag } = await resolveCreationPricing(
    operatorId,
    account.packageIds,
    requestedTag
  );
  const packageNames = pricing.packages.map((pkg) => pkg.name);
  const balanceBefore = await readWalletBalance(operatorId);

  const [result] = await createAndProvisionAccounts(
    operatorId,
    [{ fullName: account.fullName, phoneNumber: account.phoneNumber }],
    packageIds,
    pricing,
    serviceTag,
    'create_account',
    reqMeta
  );

  if (result.status !== 'created') {
    throw new AppError(
      result.errorMessage || 'Account creation failed',
      result.errorStatus || 502,
      result.errorCode || 'CRM_PROVISION_FAILED'
    );
  }

  await logAudit({
    actorType: 'operator',
    actorId: operatorId,
    action: 'ACCOUNT_CREATED',
    resourceType: 'voucher_account',
    resourceId: result.id,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: {
      fullName: result.fullName,
      phoneNumber: result.phoneNumber,
      serviceTag,
      packageIds,
      packageNames,
      amountCharged: result.amountCharged,
    },
  });

  const walletBalance = await readWalletBalance(operatorId);
  return {
    id: result.id,
    fullName: result.fullName,
    phoneNumber: result.phoneNumber,
    serviceTag,
    packageIds,
    packageNames,
    amountCharged: result.amountCharged,
    status: result.status,
    externalRef: result.externalRef || null,
    walletBalance,
    unitCost: pricing.total,
    currencyCode: pricing.currencyCode,
    balanceBefore,
    balanceAfter: walletBalance,
  };
}

export async function createBulkAccounts(operatorId, accounts, reqMeta = {}, packageIds) {
  if (accounts.length === 0) {
    throw new AppError('At least one account is required', 400, 'VALIDATION_ERROR');
  }

  if (accounts.length > config.security.bulkUploadMax) {
    throw new AppError(
      `Bulk upload limited to ${config.security.bulkUploadMax} accounts at a time`,
      400,
      'BULK_LIMIT_EXCEEDED'
    );
  }

  return withCrmSlot(operatorId, () =>
    createBulkAccountsInner(operatorId, accounts, reqMeta, packageIds)
  );
}

async function createBulkAccountsInner(operatorId, accounts, reqMeta, packageIds) {
  const resolved = await resolveCreationPricing(
    operatorId,
    packageIds ?? accounts[0]?.packageIds,
    null
  );

  const created = await createAndProvisionAccounts(
    operatorId,
    accounts,
    resolved.packageIds,
    resolved.pricing,
    resolved.serviceTag,
    'bulk_create',
    reqMeta
  );
  const successCount = created.filter((item) => item.status === 'created').length;
  const totalCharged = roundMoney(created.reduce((sum, item) => sum + (item.amountCharged || 0), 0));
  const needsReconciliation = created.filter((item) => item.errorCode === 'CRM_RECONCILIATION_REQUIRED');

  if (successCount === 0 && needsReconciliation.length === 0) {
    const firstFailed = created.find((item) => item.status === 'failed');
    throw new AppError(
      firstFailed?.errorMessage || 'Account creation failed',
      firstFailed?.errorStatus || 502,
      firstFailed?.errorCode || 'CRM_PROVISION_FAILED'
    );
  }

  await logAudit({
    actorType: 'operator',
    actorId: operatorId,
    action: accounts.length === 1 ? 'ACCOUNT_CREATED' : 'ACCOUNTS_BULK_CREATED',
    resourceType: 'voucher_account',
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: {
      count: accounts.length,
      successCount,
      failedCount: created.length - successCount,
      reconciliationCount: needsReconciliation.length,
      packageIds: resolved.packageIds,
      unitCost: resolved.pricing.total,
      totalCharged,
    },
  });

  return {
    created,
    walletBalance: await readWalletBalance(operatorId),
    unitCost: resolved.pricing.total,
    totalCharged,
    currencyCode: resolved.pricing.currencyCode,
  };
}
