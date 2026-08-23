import { config } from '../config/index.js';
import { query, getConnection } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { logAudit } from './auditService.js';
import { crmService } from './crmService.js';
import { buildDailyTrend } from '../utils/chartData.js';
import { paginationSql } from '../utils/pagination.js';
import { getOperatorPackageIds, getOperatorPackages } from './packageService.js';

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
    `SELECT o.id, o.client_name, o.package_id, o.package_type, o.account_quota, o.accounts_created, o.is_active
     FROM operators o
     WHERE o.id = ? LIMIT 1`,
    [operatorId]
  );

  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  const packages = await getOperatorPackages(operatorId);
  const packageNames = packages.map((pkg) => pkg.name);
  const packageType = packageNames.length ? packageNames.join(', ') : operator.package_type;

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

  const used = operator.accounts_created;
  const total = operator.account_quota;
  const remaining = Math.max(0, total - used);

  return {
    clientName: operator.client_name,
    packageType,
    packageNames,
    packages: packages.map((pkg) => ({ id: pkg.id, name: pkg.name })),
    packageIds: packages.map((pkg) => pkg.id),
    accountQuota: total,
    accountsCreated: used,
    remainingQuota: remaining,
    statusCounts,
    charts: {
      statusBreakdown: statusBreakdown.map((row) => ({
        status: row.status,
        count: Number(row.count) || 0,
      })),
      quotaBreakdown: [
        { label: 'Used', count: used },
        { label: 'Remaining', count: remaining },
      ],
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
    `SELECT va.id, va.full_name, va.phone_number, va.status, va.external_ref, va.error_message,
            va.created_at, va.package_id,
            GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS package_names
     FROM voucher_accounts va
     LEFT JOIN voucher_account_packages vap ON vap.voucher_account_id = va.id
     LEFT JOIN packages p ON p.id = COALESCE(vap.package_id, va.package_id)
     ${where}
     GROUP BY va.id, va.full_name, va.phone_number, va.status, va.external_ref, va.error_message,
              va.created_at, va.package_id
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
    const message = err.message || 'CRM provisioning failed';
    const code = err.code || 'CRM_PROVISION_FAILED';

    await connection.execute(
      `UPDATE voucher_accounts SET status = 'failed', error_message = ? WHERE id = ?`,
      [message, voucherAccountId]
    );

    return { success: false, error: message, code };
  }
}

async function createAndProvisionAccounts(connection, operatorId, accounts, packageIds) {
  const results = [];

  for (const account of accounts) {
    const primaryPackageId = packageIds[0];
    const [insertResult] = await connection.execute(
      `INSERT INTO voucher_accounts (operator_id, package_id, full_name, phone_number, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [operatorId, primaryPackageId, account.fullName.trim(), account.phoneNumber.trim()]
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

    results.push({
      id: voucherAccountId,
      fullName: account.fullName.trim(),
      phoneNumber: account.phoneNumber.trim(),
      packageIds,
      status: provision.success ? 'created' : 'failed',
      externalRef: provision.externalRef || null,
      errorMessage: provision.error || null,
      errorCode: provision.code || null,
    });
  }

  return results;
}

export async function createSingleAccount(operatorId, account, reqMeta = {}) {
  return createBulkAccounts(operatorId, [account], reqMeta, account.packageIds);
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
      `SELECT id, account_quota, accounts_created, is_active, client_name, package_id, package_type
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

    const remaining = operator.account_quota - operator.accounts_created;
    if (accounts.length > remaining) {
      throw new AppError(
        `Quota exceeded. You can create only ${remaining} more account(s).`,
        403,
        'QUOTA_EXCEEDED'
      );
    }

    const created = await createAndProvisionAccounts(
      connection,
      operatorId,
      accounts,
      resolvedPackageIds
    );
    const successCount = created.filter((item) => item.status === 'created').length;

    if (successCount > 0) {
      await connection.execute(
        `UPDATE operators SET accounts_created = accounts_created + ? WHERE id = ?`,
        [successCount, operatorId]
      );
    }

    await connection.commit();

    if (successCount === 0) {
      const firstError = created[0]?.errorMessage || 'Account creation failed';
      const firstCode = created.find((item) => item.status === 'failed')?.errorCode;

      if (firstCode === 'SUBSCRIPTION_EXISTS') {
        throw new AppError(firstError, 409, 'SUBSCRIPTION_EXISTS');
      }

      throw new AppError(firstError, 502, 'CRM_PROVISION_FAILED');
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
        packageIds: resolvedPackageIds,
      },
    });

    return {
      created,
      remainingQuota: remaining - successCount,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}
