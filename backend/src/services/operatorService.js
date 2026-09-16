import { config } from '../config/index.js';
import { query, getConnection } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { logAudit } from './auditService.js';
import { crmService } from './crmService.js';
import { buildDailyTrend } from '../utils/chartData.js';
import { paginationSql } from '../utils/pagination.js';
import { getOperatorPackageIds, getOperatorPackages, sumPackagePrices, assertPackagesAssignable } from './packageService.js';
import { debitWallet } from './walletService.js';
import { assertServiceTag, getAllowedServiceTags } from '../constants/serviceTags.js';

async function getOperatorServiceScope(operatorId, connection = null) {
  const runner = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : query;
  const [operator] = await runner(
    `SELECT service_scope FROM operators WHERE id = ? LIMIT 1`,
    [operatorId]
  );
  return operator?.service_scope || 'BOTH';
}

function assertOperatorServiceTag(serviceScope, serviceTag) {
  const allowed = getAllowedServiceTags(serviceScope);
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
            o.wallet_commission_type, o.wallet_commission_value
     FROM operators o
     WHERE o.id = ? LIMIT 1`,
    [operatorId]
  );

  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  const serviceScope = operator.service_scope || 'BOTH';
  const allowedServiceTags = getAllowedServiceTags(serviceScope);
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
       COALESCE(SUM(CASE WHEN type = 'debit' AND status = 'completed' THEN net_amount ELSE 0 END), 0) AS totalSpent,
       COALESCE(SUM(CASE WHEN type = 'topup' AND status = 'completed' THEN 1 ELSE 0 END), 0) AS topupCount,
       COALESCE(SUM(CASE WHEN type = 'debit' AND status = 'completed' THEN 1 ELSE 0 END), 0) AS debitCount
     FROM wallet_transactions
     WHERE operator_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)`,
    [operatorId]
  );

  const debitRows = await query(
    `SELECT net_amount, metadata
     FROM wallet_transactions
     WHERE operator_id = ? AND type = 'debit' AND status = 'completed'
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)`,
    [operatorId]
  );

  const chargeBreakdown = {
    createAccount: { count: 0, amount: 0 },
    customerTopup: { count: 0, amount: 0 },
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
    } else if (activity === 'customer_topup') {
      chargeBreakdown.customerTopup.count += 1;
      chargeBreakdown.customerTopup.amount += amount;
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
            GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS package_names
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
  const lowBalance = minPackagePrice > 0 && walletBalance < minPackagePrice;

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

export async function listAccounts(operatorId, { page = 1, limit = 20, search = '' } = {}) {
  const { page: pageNum, limit: limitNum, clause } = paginationSql(page, limit);
  const filters = ['va.operator_id = ?'];
  const params = [operatorId];

  if (search) {
    filters.push('(va.full_name LIKE ? OR va.phone_number LIKE ? OR va.status LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const where = `WHERE ${filters.join(' AND ')}`;

  const accounts = await query(
    `SELECT va.id, va.full_name, va.phone_number, va.service_tag, va.status, va.external_ref, va.error_message,
            va.created_at, va.package_id, va.amount_charged,
            GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS package_names
     FROM voucher_accounts va
     LEFT JOIN voucher_account_packages vap ON vap.voucher_account_id = va.id
     LEFT JOIN packages p ON p.id = COALESCE(vap.package_id, va.package_id)
     ${where}
     GROUP BY va.id, va.full_name, va.phone_number, va.status, va.external_ref, va.error_message,
              va.created_at, va.package_id, va.amount_charged
     ORDER BY va.created_at DESC
     ${clause}`,
    params
  );

  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM voucher_accounts va ${where}`,
    params
  );

  const total = Number(countRow.total) || 0;

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

async function provisionExistingContactInCrm(
  connection,
  voucherAccountId,
  phoneNumber,
  fullName,
  packageIds,
  crmContactId
) {
  await connection.execute(
    `UPDATE voucher_accounts SET status = 'processing' WHERE id = ?`,
    [voucherAccountId]
  );

  try {
    const result = await crmService.activatePackagesForContact(crmContactId, packageIds);
    const externalRef = result.subscriptionId || result.contactId || crmContactId;

    await connection.execute(
      `UPDATE voucher_accounts
       SET status = 'created', external_ref = ?, error_message = NULL
       WHERE id = ?`,
      [externalRef, voucherAccountId]
    );

    return { success: true, externalRef, crm: result };
  } catch (err) {
    const message = err.message || 'Activation failed';
    const code = err.code || 'CRM_PROVISION_FAILED';

    await connection.execute(
      `UPDATE voucher_accounts SET status = 'failed', error_message = ? WHERE id = ?`,
      [message, voucherAccountId]
    );

    return { success: false, error: message, code };
  }
}

async function provisionAccountInCrm(connection, voucherAccountId, phoneNumber, fullName, packageIds) {
  await connection.execute(
    `UPDATE voucher_accounts SET status = 'processing' WHERE id = ?`,
    [voucherAccountId]
  );

  try {
    const result = await crmService.provisionOttAccount(phoneNumber, fullName, packageIds);
    const externalRef =
      result.subscriptionId || result.contactId || null;

    await connection.execute(
      `UPDATE voucher_accounts
       SET status = 'created', external_ref = ?, error_message = NULL
       WHERE id = ?`,
      [externalRef, voucherAccountId]
    );

    return { success: true, externalRef, crm: result };
  } catch (err) {
    const message = err.message || 'Account setup failed';
    const code = err.code || 'CRM_PROVISION_FAILED';

    await connection.execute(
      `UPDATE voucher_accounts SET status = 'failed', error_message = ? WHERE id = ?`,
      [message, voucherAccountId]
    );

    return { success: false, error: message, code };
  }
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

export async function searchCustomers(operatorId, phoneNumber) {
  const [operator] = await query(`SELECT id, is_active FROM operators WHERE id = ? LIMIT 1`, [operatorId]);
  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }
  if (!operator.is_active) {
    throw new AppError('Operator account is inactive', 403, 'FORBIDDEN');
  }

  return crmService.searchCustomersByPhone(phoneNumber);
}

export async function activateCustomer(operatorId, data, reqMeta = {}) {
  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const [operatorRows] = await connection.execute(
      `SELECT id, wallet_balance, accounts_created, is_active, client_name, service_scope
       FROM operators WHERE id = ? FOR UPDATE`,
      [operatorId]
    );

    const operator = operatorRows[0];
    if (!operator) {
      throw new AppError('Operator not found', 404, 'NOT_FOUND');
    }
    if (!operator.is_active) {
      throw new AppError('Operator account is inactive', 403, 'FORBIDDEN');
    }

    assertOperatorServiceTag(operator.service_scope || 'BOTH', data.serviceTag);

    const resolvedPackageIds = await resolveActivatePackageIds(
      operatorId,
      data.packageIds,
      data.serviceTag,
      connection
    );

    const pricing = await sumPackagePrices(resolvedPackageIds, { connection });
    const unitCost = pricing.total;
    const walletBalance = Math.round(Number(operator.wallet_balance) * 100) / 100;

    if (walletBalance < unitCost) {
      throw new AppError(
        `Insufficient wallet balance. Required ${unitCost} ${pricing.currencyCode}, available ${walletBalance} ${pricing.currencyCode}.`,
        403,
        'INSUFFICIENT_WALLET_BALANCE'
      );
    }

    const primaryPackageId = resolvedPackageIds[0];
    const [insertResult] = await connection.execute(
      `INSERT INTO voucher_accounts (operator_id, package_id, full_name, phone_number, service_tag, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [operatorId, primaryPackageId, data.fullName.trim(), data.phoneNumber.trim(), data.serviceTag]
    );

    const voucherAccountId = insertResult.insertId;

    for (const packageId of resolvedPackageIds) {
      await connection.execute(
        `INSERT INTO voucher_account_packages (voucher_account_id, package_id) VALUES (?, ?)`,
        [voucherAccountId, packageId]
      );
    }

    const provision = await provisionExistingContactInCrm(
      connection,
      voucherAccountId,
      data.phoneNumber.trim(),
      data.fullName.trim(),
      resolvedPackageIds,
      data.crmContactId
    );

    let amountCharged = 0;
    if (provision.success) {
      const packageNames = pricing.packages.map((pkg) => pkg.name);
      await debitWallet(connection, {
        operatorId,
        amount: unitCost,
        voucherAccountId,
        description: buildChargeDescription(
          'customer_topup',
          data.fullName.trim(),
          data.phoneNumber.trim(),
          packageNames
        ),
        createdByType: 'operator',
        createdById: operatorId,
        metadata: {
          activity: 'customer_topup',
          packageIds: resolvedPackageIds,
          packageNames,
          phoneNumber: data.phoneNumber.trim(),
          customerName: data.fullName.trim(),
          serviceTag: data.serviceTag,
          crmContactId: data.crmContactId,
        },
      });

      amountCharged = unitCost;
      await connection.execute(
        `UPDATE voucher_accounts SET amount_charged = ? WHERE id = ?`,
        [unitCost, voucherAccountId]
      );

      await connection.execute(
        `UPDATE operators SET accounts_created = accounts_created + 1 WHERE id = ?`,
        [operatorId]
      );
    }

    await connection.commit();

    if (!provision.success) {
      throw new AppError(provision.error || 'Activation failed', 502, provision.code || 'CRM_PROVISION_FAILED');
    }

    const [balanceRow] = await query(
      `SELECT wallet_balance FROM operators WHERE id = ? LIMIT 1`,
      [operatorId]
    );

    await logAudit({
      actorType: 'operator',
      actorId: operatorId,
      action: 'CUSTOMER_TOPUP',
      resourceType: 'voucher_account',
      resourceId: voucherAccountId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: {
        crmContactId: data.crmContactId,
        packageIds: resolvedPackageIds,
        unitCost,
        serviceTag: data.serviceTag,
        phoneNumber: data.phoneNumber.trim(),
      },
    });

    const packageNames = pricing.packages.map((pkg) => pkg.name);

    return {
      id: voucherAccountId,
      fullName: data.fullName.trim(),
      phoneNumber: data.phoneNumber.trim(),
      serviceTag: data.serviceTag,
      packageIds: resolvedPackageIds,
      packageNames,
      amountCharged,
      status: 'created',
      externalRef: provision.externalRef || null,
      walletBalance: Math.round(Number(balanceRow.wallet_balance) * 100) / 100,
      unitCost,
      currencyCode: pricing.currencyCode,
      balanceBefore: walletBalance,
      balanceAfter: Math.round(Number(balanceRow.wallet_balance) * 100) / 100,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
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

function buildChargeDescription(activity, customerName, phoneNumber, packageNames = []) {
  const packagesLabel = packageNames.length ? packageNames.join(', ') : 'package';
  const customerLabel = `${customerName} (${phoneNumber})`;

  if (activity === 'customer_topup') {
    return `Customer top-up — ${packagesLabel} for ${customerLabel}`;
  }

  if (activity === 'bulk_create') {
    return `Bulk create — ${packagesLabel} for ${customerLabel}`;
  }

  return `Create account — ${packagesLabel} for ${customerLabel}`;
}

async function createAndProvisionAccounts(
  connection,
  operatorId,
  accounts,
  packageIds,
  unitCost,
  serviceTag,
  { activity = 'create_account', packageNames = [] } = {}
) {
  const results = [];

  for (const account of accounts) {
    const primaryPackageId = packageIds[0];
    const [insertResult] = await connection.execute(
      `INSERT INTO voucher_accounts (operator_id, package_id, full_name, phone_number, service_tag, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [operatorId, primaryPackageId, account.fullName.trim(), account.phoneNumber.trim(), serviceTag]
    );

    const voucherAccountId = insertResult.insertId;

    for (const packageId of packageIds) {
      await connection.execute(
        `INSERT INTO voucher_account_packages (voucher_account_id, package_id) VALUES (?, ?)`,
        [voucherAccountId, packageId]
      );
    }

    const provision = await provisionAccountInCrm(
      connection,
      voucherAccountId,
      account.phoneNumber.trim(),
      account.fullName.trim(),
      packageIds
    );

    let amountCharged = 0;
    if (provision.success) {
      await debitWallet(connection, {
        operatorId,
        amount: unitCost,
        voucherAccountId,
        description: buildChargeDescription(
          activity,
          account.fullName.trim(),
          account.phoneNumber.trim(),
          packageNames
        ),
        createdByType: 'operator',
        createdById: operatorId,
        metadata: {
          activity,
          packageIds,
          packageNames,
          phoneNumber: account.phoneNumber.trim(),
          customerName: account.fullName.trim(),
          serviceTag,
        },
      });

      amountCharged = unitCost;
      await connection.execute(
        `UPDATE voucher_accounts SET amount_charged = ? WHERE id = ?`,
        [unitCost, voucherAccountId]
      );

      await connection.execute(
        `UPDATE operators SET accounts_created = accounts_created + 1 WHERE id = ?`,
        [operatorId]
      );
    }

    results.push({
      id: voucherAccountId,
      fullName: account.fullName.trim(),
      phoneNumber: account.phoneNumber.trim(),
      packageIds,
      amountCharged,
      status: provision.success ? 'created' : 'failed',
      externalRef: provision.externalRef || null,
      errorMessage: provision.error || null,
      errorCode: provision.code || null,
    });
  }

  return results;
}

export async function topupCustomer(operatorId, data, reqMeta = {}) {
  return activateCustomer(operatorId, data, reqMeta);
}

export async function createSingleAccount(operatorId, account, reqMeta = {}) {
  const serviceTag = assertServiceTag(account.serviceTag);
  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const [operatorRows] = await connection.execute(
      `SELECT id, wallet_balance, accounts_created, is_active, service_scope
       FROM operators WHERE id = ? FOR UPDATE`,
      [operatorId]
    );

    const operator = operatorRows[0];
    if (!operator) {
      throw new AppError('Operator not found', 404, 'NOT_FOUND');
    }
    if (!operator.is_active) {
      throw new AppError('Operator account is inactive', 403, 'FORBIDDEN');
    }

    assertOperatorServiceTag(operator.service_scope || 'BOTH', serviceTag);

    const resolvedPackageIds = await resolveAccountPackageIds(
      operatorId,
      account.packageIds,
      connection
    );
    const pricing = await assertPackagesMatchServiceTag(resolvedPackageIds, serviceTag, connection);
    const packageNames = pricing.packages.map((pkg) => pkg.name);
    const unitCost = pricing.total;
    const walletBalance = Math.round(Number(operator.wallet_balance) * 100) / 100;

    if (walletBalance < unitCost) {
      throw new AppError(
        `Insufficient wallet balance. Required ${unitCost} ${pricing.currencyCode}, available ${walletBalance} ${pricing.currencyCode}.`,
        403,
        'INSUFFICIENT_WALLET_BALANCE'
      );
    }

    const created = await createAndProvisionAccounts(
      connection,
      operatorId,
      [{ fullName: account.fullName, phoneNumber: account.phoneNumber }],
      resolvedPackageIds,
      unitCost,
      serviceTag,
      { activity: 'create_account', packageNames }
    );

    await connection.commit();

    const result = created[0];
    if (result.status !== 'created') {
      throw new AppError(result.errorMessage || 'Account creation failed', 502, result.errorCode || 'CRM_PROVISION_FAILED');
    }

    const [balanceRow] = await query(
      `SELECT wallet_balance FROM operators WHERE id = ? LIMIT 1`,
      [operatorId]
    );

    await logAudit({
      actorType: 'operator',
      actorId: operatorId,
      action: 'ACCOUNT_CREATED',
      resourceType: 'voucher_account',
      resourceId: result.id,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: {
        fullName: account.fullName.trim(),
        phoneNumber: account.phoneNumber.trim(),
        serviceTag,
        packageIds: resolvedPackageIds,
        packageNames,
        amountCharged: result.amountCharged,
      },
    });

    return {
      id: result.id,
      fullName: account.fullName.trim(),
      phoneNumber: account.phoneNumber.trim(),
      serviceTag,
      packageIds: resolvedPackageIds,
      packageNames,
      amountCharged: result.amountCharged,
      status: result.status,
      externalRef: result.externalRef || null,
      walletBalance: Math.round(Number(balanceRow.wallet_balance) * 100) / 100,
      unitCost,
      currencyCode: pricing.currencyCode,
      balanceBefore: walletBalance,
      balanceAfter: Math.round(Number(balanceRow.wallet_balance) * 100) / 100,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
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

  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const [operatorRows] = await connection.execute(
      `SELECT id, wallet_balance, accounts_created, is_active, client_name, package_id, package_type
       FROM operators WHERE id = ? FOR UPDATE`,
      [operatorId]
    );

    const operator = operatorRows[0];
    if (!operator) {
      throw new AppError('Operator not found', 404, 'NOT_FOUND');
    }

    if (!operator.is_active) {
      throw new AppError('Operator account is inactive', 403, 'FORBIDDEN');
    }

    const resolvedPackageIds = await resolveAccountPackageIds(
      operatorId,
      packageIds ?? accounts[0]?.packageIds,
      connection
    );

    const plans = await assertPackagesAssignable(resolvedPackageIds);
    const serviceTag = plans[0]?.serviceTag || 'OTT';
    const pricing = await assertPackagesMatchServiceTag(resolvedPackageIds, serviceTag, connection);
    const packageNames = pricing.packages.map((pkg) => pkg.name);
    const unitCost = pricing.total;
    const totalCost = Math.round(unitCost * accounts.length * 100) / 100;
    const walletBalance = Math.round(Number(operator.wallet_balance) * 100) / 100;

    if (walletBalance < totalCost) {
      throw new AppError(
        `Insufficient wallet balance. Required ${totalCost} ${pricing.currencyCode}, available ${walletBalance} ${pricing.currencyCode}.`,
        403,
        'INSUFFICIENT_WALLET_BALANCE'
      );
    }

    const created = await createAndProvisionAccounts(
      connection,
      operatorId,
      accounts,
      resolvedPackageIds,
      unitCost,
      serviceTag,
      { activity: 'bulk_create', packageNames }
    );
    const successCount = created.filter((item) => item.status === 'created').length;
    const totalCharged = created.reduce((sum, item) => sum + (item.amountCharged || 0), 0);

    await connection.commit();

    if (successCount === 0) {
      const firstError = created[0]?.errorMessage || 'Account creation failed';
      const firstCode = created.find((item) => item.status === 'failed')?.errorCode;

      if (firstCode === 'SUBSCRIPTION_EXISTS') {
        throw new AppError(firstError, 409, 'SUBSCRIPTION_EXISTS');
      }

      throw new AppError(firstError, 502, 'CRM_PROVISION_FAILED');
    }

    const [balanceRow] = await query(
      `SELECT wallet_balance FROM operators WHERE id = ? LIMIT 1`,
      [operatorId]
    );

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
        packageIds: resolvedPackageIds,
        unitCost,
        totalCharged,
      },
    });

    return {
      created,
      walletBalance: Math.round(Number(balanceRow.wallet_balance) * 100) / 100,
      unitCost,
      totalCharged,
      currencyCode: pricing.currencyCode,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
