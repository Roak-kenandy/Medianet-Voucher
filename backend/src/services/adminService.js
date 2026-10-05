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
import { assertPackagesMatchServiceTypes, legacyServiceScope } from '../constants/serviceTags.js';
import {
  assertPackagesMatchSalesModels,
  getOperatorServiceTypeKeys,
  getSalesModelIdsByOperatorIds,
  getServiceTypeKeysByOperatorIds,
  resolveSalesModelIds,
  resolveServiceTypeKeys,
  syncOperatorSalesModels,
  syncOperatorServiceTypes,
} from './crmConfigService.js';
import {
  normalizePortalRole,
  parseOperatorPermissions,
} from '../constants/operatorPermissions.js';
import { getSalesDashboardStats } from './salesReportService.js';
import { createOperatorApiKey } from './operatorApiKeyService.js';
import {
  assertPackageGroupsExist,
  getPackageGroupsByOperatorIds,
  syncOperatorPackageGroups,
} from './packageGroupService.js';
import {
  endAllOperatorSessions,
  insertOperatorUser,
  loginEmailExists,
  serializePortalPermissions,
} from './operatorUserService.js';

/**
 * Validates what an operator is being given: individually assigned packages and/or package
 * groups. At least one of the two is required. Individual packages must match the operator's
 * customer types and sales models; group packages outside them are simply not offered to
 * that operator.
 */
async function resolvePackageAssignment(
  packageIds = [],
  packageGroupIds = [],
  { serviceTypeKeys = [], salesModelIds = [] } = {}
) {
  const groups = await assertPackageGroupsExist(packageGroupIds);
  const hasDirect = (packageIds || []).some((id) => Number(id));
  if (!hasDirect && !groups.length) {
    throw new AppError('Select at least one package or package group', 400, 'PACKAGE_REQUIRED');
  }

  const plans = hasDirect ? await assertPackagesAssignable(packageIds) : [];
  assertPackagesMatchServiceTypes(plans, serviceTypeKeys);
  assertPackagesMatchSalesModels(plans, salesModelIds);

  const labels = [...plans.map((plan) => plan.name), ...groups.map((group) => `Group: ${group.name}`)];
  return {
    plans,
    groups,
    packageIds: plans.map((plan) => plan.id),
    groupIds: groups.map((group) => group.id),
    // Legacy display columns on operators; the live list always comes from the join tables.
    packageSummary: labels.join(', ').slice(0, 100),
    primaryPackageId: plans[0]?.id ?? null,
  };
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
    SELECT client_name AS clientName, accounts_created AS accountsCreated, wallet_balance AS walletBalance
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

  const sales = await getSalesDashboardStats({ days: 30 });

  return {
    ...stats,
    sales,
    charts: {
      statusBreakdown: statusBreakdown.map((row) => ({
        status: row.status,
        count: Number(row.count) || 0,
      })),
      activityTrend: buildDailyTrend(activityRows, 30),
      operatorAccounts: operatorAccounts.map((row) => ({
        clientName: row.clientName,
        accountsCreated: Number(row.accountsCreated) || 0,
        walletBalance: Number(row.walletBalance) || 0,
      })),
      operatorStatus: [
        { label: 'Active', count: Number(operatorStatus[0]?.active) || 0 },
        { label: 'Inactive', count: Number(operatorStatus[0]?.inactive) || 0 },
      ],
      topupCollectedTrend: sales.charts.topupCollectedTrend,
      walletSpendTrend: sales.charts.walletSpendTrend,
      topOperatorsBySales: sales.charts.topOperatorsBySales,
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

/** operators.email is the company contact address; it is unique among operators. */
async function operatorContactEmailExists(email, excludeOperatorId = null) {
  const normalized = email.toLowerCase().trim();
  const rows =
    excludeOperatorId != null
      ? await query('SELECT id FROM operators WHERE email = ? AND id != ? LIMIT 1', [normalized, excludeOperatorId])
      : await query('SELECT id FROM operators WHERE email = ? LIMIT 1', [normalized]);
  return rows.length > 0;
}

/**
 * Ends every session of a staff account inside the caller's transaction: live refresh tokens
 * are revoked, older rotated tokens can no longer trigger reuse detection, and the credentials
 * version bump rejects outstanding access tokens on their next request.
 */
async function endAdminSessions(connection, adminId, reason) {
  await connection.execute(
    `UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = ?
     WHERE user_type = 'admin' AND user_id = ? AND revoked_at IS NULL`,
    [reason, adminId]
  );
  await connection.execute(
    `UPDATE refresh_tokens SET revoked_reason = 'superseded'
     WHERE user_type = 'admin' AND user_id = ? AND revoked_reason = 'rotated'`,
    [adminId]
  );
  await connection.execute(
    `UPDATE admins SET credentials_version = credentials_version + 1 WHERE id = ?`,
    [adminId]
  );
}

/**
 * Activation state change. Deactivating a staff account ends its sessions; deactivating an
 * operator ends the sessions of every one of its users. Reactivating staff clears a login lock.
 */
async function setAccountActive(userType, targetId, isActive) {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    if (userType === 'operator') {
      await connection.execute(`UPDATE operators SET is_active = ? WHERE id = ?`, [isActive ? 1 : 0, targetId]);
      if (!isActive) await endAllOperatorSessions(connection, targetId, 'deactivated');
    } else if (isActive) {
      await connection.execute(
        `UPDATE admins
         SET is_active = 1, failed_login_attempts = 0, locked_until = NULL, failed_login_window_start = NULL
         WHERE id = ?`,
        [targetId]
      );
    } else {
      await connection.execute(`UPDATE admins SET is_active = 0 WHERE id = ?`, [targetId]);
      await endAdminSessions(connection, targetId, 'deactivated');
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

export async function createAdmin(actorAdminId, actorRole, data, reqMeta = {}) {
  if (!hasPermission(actorRole, 'createAdmin')) {
    throw new AppError('Access denied', 403, 'FORBIDDEN');
  }

  if (await loginEmailExists(data.email)) {
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

  await setAccountActive('admin', targetAdminId, Boolean(isActive));

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

/** Staff reset of another staff member's password (ends that member's sessions). */
export async function resetAdminPassword(actorAdminId, targetAdminId, newPassword, reqMeta = {}) {
  const [admin] = await query('SELECT id FROM admins WHERE id = ? LIMIT 1', [targetAdminId]);
  if (!admin) {
    throw new AppError('Admin not found', 404, 'NOT_FOUND');
  }

  const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE admins
       SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, failed_login_window_start = NULL
       WHERE id = ?`,
      [passwordHash, targetAdminId]
    );
    await endAdminSessions(connection, targetAdminId, 'password_reset');
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  await logAudit({
    actorType: 'admin',
    actorId: actorAdminId,
    action: 'ADMIN_PASSWORD_RESET',
    resourceType: 'admin',
    resourceId: targetAdminId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
  });

  return { id: targetAdminId };
}

/** Staff member changes their own password after proving the current one. */
export async function changeOwnAdminPassword(adminId, currentPassword, newPassword, reqMeta = {}) {
  const [admin] = await query(
    'SELECT id, password_hash FROM admins WHERE id = ? AND is_active = 1 LIMIT 1',
    [adminId]
  );
  if (!admin) {
    throw new AppError('Admin not found', 404, 'NOT_FOUND');
  }
  if (!(await bcrypt.compare(currentPassword, admin.password_hash))) {
    throw new AppError('Current password is incorrect', 400, 'INVALID_CREDENTIALS');
  }
  if (currentPassword === newPassword) {
    throw new AppError('New password must be different from the current password', 400, 'VALIDATION_ERROR');
  }

  const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`UPDATE admins SET password_hash = ? WHERE id = ?`, [passwordHash, adminId]);
    await endAdminSessions(connection, adminId, 'password_reset');
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'ADMIN_PASSWORD_CHANGED',
    resourceType: 'admin',
    resourceId: adminId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
  });

  return { id: adminId, reauthRequired: true };
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
       o.id, o.client_name, o.package_id, o.package_type, o.service_scope, o.notes, o.email, o.wallet_balance,
       o.wallet_commission_type, o.wallet_commission_value, o.wallet_self_topup_enabled,
       (SELECT COUNT(*) FROM operator_users u WHERE u.operator_id = o.id) AS user_count,
       (SELECT COUNT(*) FROM operator_users u WHERE u.operator_id = o.id AND u.is_active = 1) AS active_user_count,
       o.trial_account_limit, o.trial_accounts_used, o.accounts_created,
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
  const operatorIds = operators.map((op) => op.id);
  const packagesMap = await getOperatorPackagesByOperatorIds(operatorIds);
  const groupsMap = await getPackageGroupsByOperatorIds(operatorIds);
  const serviceTypesMap = await getServiceTypeKeysByOperatorIds(operatorIds);
  const salesModelsMap = await getSalesModelIdsByOperatorIds(operatorIds);

  const enrichedOperators = operators.map((operator) => {
    // `packages` is everything the operator can sell; `direct` marks individual assignments.
    const packages = packagesMap.get(operator.id) || [];
    const packageGroups = groupsMap.get(operator.id) || [];
    const serviceTypes = serviceTypesMap.get(operator.id) || { keys: [], defaultKey: null };
    const salesModels = salesModelsMap.get(operator.id) || [];
    return {
      ...operator,
      service_type_keys: serviceTypes.keys,
      default_service_type_key: serviceTypes.defaultKey,
      sales_models: salesModels,
      sales_model_ids: salesModels.map((model) => model.id),
      packages,
      package_groups: packageGroups,
      package_group_ids: packageGroups.map((group) => group.id),
      direct_package_ids: packages.filter((pkg) => pkg.direct).map((pkg) => pkg.id),
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

/**
 * Creates the operator (company) and its first portal user. The email and password given
 * here are that first user's login; further users are added from Manage Users.
 */
export async function createOperator(adminId, data, reqMeta = {}) {
  if ((await loginEmailExists(data.email)) || (await operatorContactEmailExists(data.email))) {
    throw new AppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
  }

  const serviceTypes = await resolveServiceTypeKeys(data.serviceTypeKeys, data.defaultServiceTypeKey);
  const salesModelIds = await resolveSalesModelIds(data.salesModelIds);
  const serviceScope = legacyServiceScope(serviceTypes.keys);
  const assignment = await resolvePackageAssignment(data.packageIds, data.packageGroupIds, {
    serviceTypeKeys: serviceTypes.keys,
    salesModelIds,
  });
  const { plans, packageSummary, primaryPackageId } = assignment;
  const passwordHash = await bcrypt.hash(data.password, config.security.bcryptRounds);

  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `INSERT INTO operators
         (admin_id, client_name, package_type, service_scope, package_id, notes, email, password_hash,
          account_quota, wallet_balance, wallet_commission_type, wallet_commission_value,
          wallet_self_topup_enabled, portal_role, portal_permissions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
      [
        adminId,
        data.clientName.trim(),
        packageSummary,
        serviceScope,
        primaryPackageId,
        data.notes?.trim() || null,
        data.email.toLowerCase().trim(),
        passwordHash,
        data.walletCommissionType,
        data.walletCommissionValue,
        data.canSelfTopup === false ? 0 : 1,
        normalizePortalRole(data.portalRole),
        serializePortalPermissions(data.portalRole, data.portalPermissions),
      ]
    );

    const operatorId = result.insertId;
    await syncOperatorServiceTypes(connection, operatorId, serviceTypes.keys, serviceTypes.defaultKey);
    await syncOperatorSalesModels(connection, operatorId, salesModelIds);
    await syncOperatorPackages(operatorId, assignment.packageIds, connection);
    await syncOperatorPackageGroups(operatorId, assignment.groupIds, connection);

    const firstUserId = await insertOperatorUser(
      connection,
      operatorId,
      {
        name: data.userName?.trim() || data.clientName,
        email: data.email,
        portalRole: data.portalRole,
        portalPermissions: data.portalPermissions,
      },
      { passwordHash, adminId }
    );

    const apiKey = data.generateApiKey
      ? await createOperatorApiKey(adminId, operatorId, { name: 'Initial key' }, reqMeta, connection)
      : null;

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
        packageIds: assignment.packageIds,
        packageGroupIds: assignment.groupIds,
        packageNames: plans.map((plan) => plan.name),
        walletCommissionType: data.walletCommissionType,
        walletCommissionValue: data.walletCommissionValue,
        canSelfTopup: data.canSelfTopup !== false,
        serviceTypeKeys: serviceTypes.keys,
        salesModelIds,
        firstUserId,
        apiKeyIssued: apiKey ? { apiKeyId: apiKey.id, keyPrefix: apiKey.keyPrefix } : null,
      },
    });

    return {
      id: operatorId,
      clientName: data.clientName,
      serviceTypeKeys: serviceTypes.keys,
      salesModelIds,
      packageIds: assignment.packageIds,
        packageGroupIds: assignment.groupIds,
      packageType: packageSummary,
      packages: plans.map((plan) => ({ id: plan.id, name: plan.name })),
      notes: data.notes?.trim() || null,
      email: data.email.toLowerCase().trim(),
      walletBalance: 0,
      walletCommissionType: data.walletCommissionType,
      walletCommissionValue: data.walletCommissionValue,
      canSelfTopup: data.canSelfTopup !== false,
      portalRole: normalizePortalRole(data.portalRole),
      portalPermissions: parseOperatorPermissions(
        normalizePortalRole(data.portalRole),
        data.portalPermissions
      ),
      accountsCreated: 0,
      isActive: true,
      firstUserId,
      // Present only when a key was requested; this is the one time the full key is returned.
      apiKey,
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

  await setAccountActive('operator', operatorId, Boolean(isActive));

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

/**
 * Replaces what an operator may sell: its individual packages and the package groups it
 * belongs to. The rest of the operator record is left alone.
 */
export async function updateOperatorPackages(adminId, operatorId, { packageIds, packageGroupIds }, reqMeta = {}) {
  const [operator] = await query(`SELECT id FROM operators WHERE id = ? LIMIT 1`, [operatorId]);
  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  const assignment = await resolvePackageAssignment(packageIds, packageGroupIds, {
    serviceTypeKeys: await getOperatorServiceTypeKeys(operatorId),
    salesModelIds: ((await getSalesModelIdsByOperatorIds([operatorId])).get(operatorId) || []).map((m) => m.id),
  });

  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE operators SET package_type = ?, package_id = ? WHERE id = ?`,
      [assignment.packageSummary, assignment.primaryPackageId, operatorId]
    );
    await syncOperatorPackages(operatorId, assignment.packageIds, connection);
    await syncOperatorPackageGroups(operatorId, assignment.groupIds, connection);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'OPERATOR_PACKAGES_UPDATED',
    resourceType: 'operator',
    resourceId: operatorId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: {
      packageIds: assignment.packageIds,
      packageNames: assignment.plans.map((plan) => plan.name),
      packageGroupIds: assignment.groupIds,
      packageGroupNames: assignment.groups.map((group) => group.name),
    },
  });

  return {
    id: operatorId,
    packageIds: assignment.packageIds,
    packageGroupIds: assignment.groupIds,
    packageType: assignment.packageSummary,
    packages: assignment.plans.map((plan) => ({ id: plan.id, name: plan.name })),
    packageGroups: assignment.groups,
  };
}

/**
 * Updates the operator (company) record. Logins, passwords, roles and permissions belong to
 * the operator's users and are managed in operatorUserService.
 */
export async function updateOperator(adminId, operatorId, data, reqMeta = {}) {
  const [operator] = await query(
    `SELECT id, client_name, email, accounts_created, is_active FROM operators WHERE id = ? LIMIT 1`,
    [operatorId]
  );

  if (!operator) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }

  // Omitting packageGroupIds keeps the operator's current groups.
  const currentGroupIds = (await getPackageGroupsByOperatorIds([operatorId])).get(operatorId)?.map((g) => g.id) || [];
  // Omitting the customer types or sales models keeps the operator's current ones.
  const currentTypes = (await getServiceTypeKeysByOperatorIds([operatorId])).get(operatorId) || { keys: [], defaultKey: null };
  const serviceTypes = await resolveServiceTypeKeys(
    data.serviceTypeKeys ?? currentTypes.keys,
    data.defaultServiceTypeKey ?? currentTypes.defaultKey
  );
  const salesModelIds = await resolveSalesModelIds(
    data.salesModelIds ??
      ((await getSalesModelIdsByOperatorIds([operatorId])).get(operatorId) || []).map((model) => model.id)
  );
  const serviceScope = legacyServiceScope(serviceTypes.keys);
  const assignment = await resolvePackageAssignment(
    data.packageIds,
    data.packageGroupIds ?? currentGroupIds,
    { serviceTypeKeys: serviceTypes.keys, salesModelIds }
  );
  const { plans, packageSummary, primaryPackageId } = assignment;
  const normalizedEmail = data.email.toLowerCase().trim();

  if (normalizedEmail !== operator.email && (await operatorContactEmailExists(normalizedEmail, operatorId))) {
    throw new AppError('Another operator already uses this contact email', 409, 'EMAIL_EXISTS');
  }

  const deactivated = Boolean(operator.is_active) && !data.isActive;

  const connection = await getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      `UPDATE operators
       SET client_name = ?, package_type = ?, service_scope = ?, package_id = ?, notes = ?, email = ?,
           wallet_commission_type = ?, wallet_commission_value = ?, wallet_self_topup_enabled = ?,
           is_active = ?
       WHERE id = ?`,
      [
        data.clientName.trim(),
        packageSummary,
        serviceScope,
        primaryPackageId,
        data.notes?.trim() || null,
        normalizedEmail,
        data.walletCommissionType,
        data.walletCommissionValue,
        data.canSelfTopup === false ? 0 : 1,
        data.isActive ? 1 : 0,
        operatorId,
      ]
    );
    await syncOperatorServiceTypes(connection, operatorId, serviceTypes.keys, serviceTypes.defaultKey);
    await syncOperatorSalesModels(connection, operatorId, salesModelIds);
    await syncOperatorPackages(operatorId, assignment.packageIds, connection);
    await syncOperatorPackageGroups(operatorId, assignment.groupIds, connection);

    if (deactivated) {
      // Every user of this operator is signed out and their access tokens stop working.
      await endAllOperatorSessions(connection, operatorId, 'deactivated');
    }

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
        packageIds: assignment.packageIds,
        packageGroupIds: assignment.groupIds,
        packageNames: plans.map((plan) => plan.name),
        walletCommissionType: data.walletCommissionType,
        walletCommissionValue: data.walletCommissionValue,
        canSelfTopup: data.canSelfTopup !== false,
        serviceTypeKeys: serviceTypes.keys,
        salesModelIds,
        isActive: data.isActive,
        contactEmailChanged: normalizedEmail !== operator.email,
      },
    });

    const [updated] = await query(
      `SELECT wallet_balance FROM operators WHERE id = ? LIMIT 1`,
      [operatorId]
    );

    return {
      id: operatorId,
      clientName: data.clientName.trim(),
      packageIds: assignment.packageIds,
        packageGroupIds: assignment.groupIds,
      packageType: packageSummary,
      packages: plans.map((plan) => ({ id: plan.id, name: plan.name })),
      notes: data.notes?.trim() || null,
      email: normalizedEmail,
      walletBalance: Number(updated?.wallet_balance) || 0,
      walletCommissionType: data.walletCommissionType,
      walletCommissionValue: data.walletCommissionValue,
      canSelfTopup: data.canSelfTopup !== false,
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
