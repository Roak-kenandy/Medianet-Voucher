import bcrypt from 'bcrypt';
import { config } from '../config/index.js';
import { query, getConnection } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { hasPermission } from '../constants/permissions.js';
import { logAudit } from './auditService.js';
import { buildDailyTrend } from '../utils/chartData.js';
import { paginationSql } from '../utils/pagination.js';
import {
  assertPackagesAssignable,
  getActivePackages,
  getOperatorPackagesByOperatorIds,
  syncOperatorPackages,
} from './packageService.js';

function formatPackageSummary(plans = []) {
  return plans.map((plan) => plan.name).join(', ');
}

export async function getAdminStats() {
  const [stats] = await query(`
    SELECT
      (SELECT COUNT(*) FROM admins) AS totalAdmins,
      (SELECT COUNT(*) FROM admins WHERE is_active = 1) AS activeAdmins,
      (SELECT COUNT(*) FROM operators) AS totalOperators,
      (SELECT COUNT(*) FROM operators WHERE is_active = 1) AS activeOperators,
      (SELECT COALESCE(SUM(accounts_created), 0) FROM operators) AS totalAccountsCreated,
      (SELECT COUNT(*) FROM voucher_accounts) AS totalVoucherRecords
  `);

  const statusBreakdown = await query(`
    SELECT status, COUNT(*) AS count
    FROM voucher_accounts
    GROUP BY status
  `);

  const activityRows = await query(`
    SELECT DATE(created_at) AS date, COUNT(*) AS count
    FROM voucher_accounts
    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);

  const operatorAccounts = await query(`
    SELECT client_name AS clientName, accounts_created AS accountsCreated, account_quota AS accountQuota
    FROM operators
    ORDER BY accounts_created DESC
    LIMIT 8
  `);

  const operatorStatus = await query(`
    SELECT
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive
    FROM operators
  `);

  return {
    ...stats,
    charts: {
      statusBreakdown: statusBreakdown.map((row) => ({
        status: row.status,
        count: Number(row.count) || 0,
      })),
      activityTrend: buildDailyTrend(activityRows, 30),
      operatorAccounts: operatorAccounts.map((row) => ({
        clientName: row.clientName,
        accountsCreated: Number(row.accountsCreated) || 0,
        accountQuota: Number(row.accountQuota) || 0,
        percentUsed:
          row.accountQuota > 0
            ? Math.round((row.accountsCreated / row.accountQuota) * 100)
            : 0,
      })),
      operatorStatus: [
        { label: 'Active', count: Number(operatorStatus[0]?.active) || 0 },
        { label: 'Inactive', count: Number(operatorStatus[0]?.inactive) || 0 },
      ],
    },
  };
}

export async function listAdmins({ page = 1, limit = 20, search = '' } = {}) {
  const { page: pageNum, limit: limitNum, clause } = paginationSql(page, limit);
  const filters = [];
  const params = [];

  if (search) {
    filters.push('(name LIKE ? OR email LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const admins = await query(
    `SELECT id, name, email, role, is_active, created_at, updated_at
     FROM admins
     ${where}
     ORDER BY created_at DESC
     ${clause}`,
    params
  );

  const [countRow] = await query(
    `SELECT COUNT(*) AS total FROM admins ${where}`,
    params
  );

  const total = Number(countRow.total) || 0;

  return {
    admins,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
  };
}

async function emailExistsInSystem(email, excludeOperatorId = null) {
  const normalized = email.toLowerCase().trim();
  const admins = await query('SELECT id FROM admins WHERE email = ? LIMIT 1', [normalized]);
  if (admins.length) return true;

  const operatorSql =
    excludeOperatorId != null
      ? 'SELECT id FROM operators WHERE email = ? AND id != ? LIMIT 1'
      : 'SELECT id FROM operators WHERE email = ? LIMIT 1';
  const operatorParams =
    excludeOperatorId != null ? [normalized, excludeOperatorId] : [normalized];
  const operators = await query(operatorSql, operatorParams);
  return operators.length > 0;
}

export async function createAdmin(actorAdminId, actorRole, data, reqMeta = {}) {
  if (!hasPermission(actorRole, 'createAdmin')) {
    throw new AppError('Access denied', 403, 'FORBIDDEN');
  }

  if (await emailExistsInSystem(data.email)) {
    throw new AppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
  }

  const staffRole = data.role || 'admin';
  const passwordHash = await bcrypt.hash(data.password, config.security.bcryptRounds);

  const result = await query(
    `INSERT INTO admins (name, email, role, password_hash) VALUES (?, ?, ?, ?)`,
    [data.name.trim(), data.email.toLowerCase().trim(), staffRole, passwordHash]
  );

  await logAudit({
    actorType: 'admin',
    actorId: actorAdminId,
    action: 'ADMIN_CREATED',
    resourceType: 'admin',
    resourceId: result.insertId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { name: data.name.trim(), role: staffRole },
  });

  return {
    id: result.insertId,
    name: data.name.trim(),
    email: data.email.toLowerCase().trim(),
    role: staffRole,
    isActive: true,
  };
}

export async function updateAdminStatus(actorAdminId, targetAdminId, isActive, reqMeta = {}) {
  if (actorAdminId === targetAdminId && !isActive) {
    throw new AppError('You cannot deactivate your own account', 400, 'SELF_DEACTIVATE');
  }

  const admin = await query('SELECT id FROM admins WHERE id = ? LIMIT 1', [targetAdminId]);
  if (!admin.length) {
    throw new AppError('Admin not found', 404, 'NOT_FOUND');
  }

  await query('UPDATE admins SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, targetAdminId]);

  await logAudit({
    actorType: 'admin',
    actorId: actorAdminId,
    action: isActive ? 'ADMIN_ACTIVATED' : 'ADMIN_DEACTIVATED',
    resourceType: 'admin',
    resourceId: targetAdminId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
  });

  return { id: targetAdminId, isActive };
}

export async function listOperators({ page = 1, limit = 20, search = '' } = {}) {
  const { page: pageNum, limit: limitNum, clause } = paginationSql(page, limit);
  const filters = [];
  const params = [];

  if (search) {
    filters.push('(o.client_name LIKE ? OR o.email LIKE ? OR p.name LIKE ? OR o.notes LIKE ? OR o.package_type LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term, term);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const operators = await query(
    `SELECT DISTINCT
       o.id, o.client_name, o.package_id, o.package_type, o.notes, o.email, o.account_quota, o.accounts_created,
       o.is_active, o.created_at, o.updated_at,
       a.name AS created_by_name
     FROM operators o
     JOIN admins a ON a.id = o.admin_id
     LEFT JOIN operator_packages op ON op.operator_id = o.id
     LEFT JOIN packages p ON p.id = op.package_id
     ${where}
     ORDER BY o.created_at DESC
     ${clause}`,
    params
  );

  const [countRow] = await query(
    `SELECT COUNT(DISTINCT o.id) AS total
     FROM operators o
     JOIN admins a ON a.id = o.admin_id
     LEFT JOIN operator_packages op ON op.operator_id = o.id
     LEFT JOIN packages p ON p.id = op.package_id
     ${where}`,
    params
  );

  const total = Number(countRow.total) || 0;
  const packagesMap = await getOperatorPackagesByOperatorIds(operators.map((op) => op.id));

  const enrichedOperators = operators.map((operator) => {
    const packages = packagesMap.get(operator.id) || [];
    return {
      ...operator,
      packages,
      package_ids: packages.map((pkg) => pkg.id),
      package_names: packages.map((pkg) => pkg.name),
      package_name: packages.map((pkg) => pkg.name).join(', ') || operator.package_type,
    };
  });

  return {
    operators: enrichedOperators,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
  };
}

export async function createOperator(adminId, data, reqMeta = {}) {
  if (await emailExistsInSystem(data.email)) {
    throw new AppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
  }

  const plans = await assertPackagesAssignable(data.packageIds);
  const passwordHash = await bcrypt.hash(data.password, config.security.bcryptRounds);
  const packageSummary = formatPackageSummary(plans);
  const primaryPackageId = plans[0].id;

  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `INSERT INTO operators (admin_id, client_name, package_type, package_id, notes, email, password_hash, account_quota)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        adminId,
        data.clientName.trim(),
        packageSummary,
        primaryPackageId,
        data.notes?.trim() || null,
        data.email.toLowerCase().trim(),
        passwordHash,
        data.accountQuota,
      ]
    );

    const operatorId = result.insertId;
    await syncOperatorPackages(operatorId, data.packageIds, connection);

    await connection.commit();

    await logAudit({
      actorType: 'admin',
      actorId: adminId,
      action: 'OPERATOR_CREATED',
      resourceType: 'operator',
      resourceId: operatorId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: {
        clientName: data.clientName,
        packageIds: data.packageIds,
        packageNames: plans.map((plan) => plan.name),
        accountQuota: data.accountQuota,
      },
    });

    return {
      id: operatorId,
      clientName: data.clientName,
      packageIds: data.packageIds,
      packageType: packageSummary,
      packages: plans.map((plan) => ({ id: plan.id, name: plan.name })),
      notes: data.notes?.trim() || null,
      email: data.email.toLowerCase().trim(),
      accountQuota: data.accountQuota,
      accountsCreated: 0,
      isActive: true,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function updateOperatorStatus(adminId, operatorId, isActive, reqMeta = {}) {
  const operator = await query('SELECT id FROM operators WHERE id = ? LIMIT 1', [operatorId]);
  if (!operator.length) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  await query('UPDATE operators SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, operatorId]);

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: isActive ? 'OPERATOR_ACTIVATED' : 'OPERATOR_DEACTIVATED',
    resourceType: 'operator',
    resourceId: operatorId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
  });

  return { id: operatorId, isActive };
}

export async function updateOperatorQuota(adminId, operatorId, accountQuota, reqMeta = {}) {
  const operator = await query(
    'SELECT id, accounts_created FROM operators WHERE id = ? LIMIT 1',
    [operatorId]
  );

  if (!operator.length) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  if (accountQuota < operator[0].accounts_created) {
    throw new AppError(
      `Quota cannot be less than accounts already created (${operator[0].accounts_created})`,
      400,
      'QUOTA_TOO_LOW'
    );
  }

  await query('UPDATE operators SET account_quota = ? WHERE id = ?', [accountQuota, operatorId]);

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'OPERATOR_QUOTA_UPDATED',
    resourceType: 'operator',
    resourceId: operatorId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { accountQuota },
  });

  return { id: operatorId, accountQuota };
}

export async function updateOperator(adminId, operatorId, data, reqMeta = {}) {
  const [operator] = await query(
    `SELECT id, client_name, package_type, package_id, email, account_quota, accounts_created, is_active
     FROM operators WHERE id = ? LIMIT 1`,
    [operatorId]
  );

  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  const plans = await assertPackagesAssignable(data.packageIds);
  const packageSummary = formatPackageSummary(plans);
  const primaryPackageId = plans[0].id;
  const normalizedEmail = data.email.toLowerCase().trim();

  if (normalizedEmail !== operator.email && (await emailExistsInSystem(normalizedEmail, operatorId))) {
    throw new AppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
  }

  if (data.accountQuota < operator.accounts_created) {
    throw new AppError(
      `Quota cannot be less than accounts already created (${operator.accounts_created})`,
      400,
      'QUOTA_TOO_LOW'
    );
  }

  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const fields = [
      data.clientName.trim(),
      packageSummary,
      primaryPackageId,
      data.notes?.trim() || null,
      normalizedEmail,
      data.accountQuota,
      data.isActive ? 1 : 0,
      operatorId,
    ];

    let sql = `
      UPDATE operators
      SET client_name = ?, package_type = ?, package_id = ?, notes = ?, email = ?, account_quota = ?, is_active = ?
      WHERE id = ?
    `;

    if (data.password?.trim()) {
      const passwordHash = await bcrypt.hash(data.password, config.security.bcryptRounds);
      sql = `
        UPDATE operators
        SET client_name = ?, package_type = ?, package_id = ?, notes = ?, email = ?, account_quota = ?, is_active = ?, password_hash = ?
        WHERE id = ?
      `;
      fields.splice(7, 0, passwordHash);
    }

    await connection.execute(sql, fields);
    await syncOperatorPackages(operatorId, data.packageIds, connection);

    await connection.commit();

    await logAudit({
      actorType: 'admin',
      actorId: adminId,
      action: 'OPERATOR_UPDATED',
      resourceType: 'operator',
      resourceId: operatorId,
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: {
        clientName: data.clientName.trim(),
        packageIds: data.packageIds,
        packageNames: plans.map((plan) => plan.name),
        accountQuota: data.accountQuota,
        isActive: data.isActive,
        passwordChanged: Boolean(data.password?.trim()),
      },
    });

    return {
      id: operatorId,
      clientName: data.clientName.trim(),
      packageIds: data.packageIds,
      packageType: packageSummary,
      packages: plans.map((plan) => ({ id: plan.id, name: plan.name })),
      notes: data.notes?.trim() || null,
      email: normalizedEmail,
      accountQuota: data.accountQuota,
      accountsCreated: operator.accounts_created,
      isActive: data.isActive,
    };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export { getActivePackages };
