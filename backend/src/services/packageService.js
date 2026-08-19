import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { logAudit } from './auditService.js';
import { paginationSql } from '../utils/pagination.js';

export async function listPackages({ page = 1, limit = 20, search = '', activeOnly = false } = {}) {
  const { page: pageNum, limit: limitNum, clause } = paginationSql(page, limit);
  const filters = [];
  const params = [];

  if (activeOnly) {
    filters.push('is_active = 1');
  }

  if (search) {
    filters.push('(name LIKE ? OR sku LIKE ? OR product_id LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const packages = await query(
    `SELECT id, name, sku, product_id, price_term_id, price_amount, currency_code,
            description, is_active, created_at, updated_at
     FROM packages
     ${where}
     ORDER BY name ASC
     ${clause}`,
    params
  );

  const [countRow] = await query(`SELECT COUNT(*) AS total FROM packages ${where}`, params);
  const total = Number(countRow.total) || 0;

  return {
    packages,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum) || 1,
    },
  };
}

export async function getActivePackages() {
  return query(
    `SELECT id, name, sku, product_id, price_term_id, price_amount, currency_code, description
     FROM packages
     WHERE is_active = 1
     ORDER BY name ASC`
  );
}

export async function getPackageById(packageId) {
  const [pkg] = await query(
    `SELECT id, name, sku, product_id, price_term_id, price_amount, currency_code, description, is_active
     FROM packages WHERE id = ? LIMIT 1`,
    [packageId]
  );
  return pkg || null;
}

export async function getPlanByPackageId(packageId) {
  const pkg = await getPackageById(packageId);

  if (!pkg || !pkg.is_active) {
    return null;
  }

  return {
    id: pkg.id,
    name: pkg.name,
    product_id: pkg.product_id,
    price_term_id: pkg.price_term_id,
    priceAmount: Number(pkg.price_amount),
    currencyCode: pkg.currency_code,
  };
}

export async function assertPackageAssignable(packageId) {
  const plan = await getPlanByPackageId(packageId);
  if (!plan) {
    throw new AppError('Selected package is not available', 400, 'PACKAGE_NOT_FOUND');
  }
  return plan;
}

export async function createPackage(adminId, data, reqMeta = {}) {
  const existing = await query(
    `SELECT id FROM packages WHERE product_id = ? AND price_term_id = ? LIMIT 1`,
    [data.productId, data.priceTermId]
  );

  if (existing.length) {
    throw new AppError('This CRM product and price combination already exists', 409, 'PACKAGE_EXISTS');
  }

  const result = await query(
    `INSERT INTO packages
       (name, sku, product_id, price_term_id, price_amount, currency_code, description, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name.trim(),
      data.sku?.trim() || null,
      data.productId,
      data.priceTermId,
      data.priceAmount,
      data.currencyCode || 'MVR',
      data.description?.trim() || null,
      adminId,
    ]
  );

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'PACKAGE_CREATED',
    resourceType: 'package',
    resourceId: result.insertId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { name: data.name, productId: data.productId, priceTermId: data.priceTermId },
  });

  return getPackageById(result.insertId);
}

export async function assertPackagesAssignable(packageIds = []) {
  const uniqueIds = [...new Set(packageIds.map((id) => Number(id)).filter(Boolean))];
  if (!uniqueIds.length) {
    throw new AppError('At least one package is required', 400, 'PACKAGE_REQUIRED');
  }

  const plans = [];
  for (const packageId of uniqueIds) {
    plans.push(await assertPackageAssignable(packageId));
  }
  return plans;
}

export async function getOperatorPackages(operatorId, { connection = null } = {}) {
  const runner = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : query;

  return runner(
    `SELECT p.id, p.name, p.sku, p.product_id, p.price_term_id, p.price_amount, p.currency_code, p.is_active
     FROM operator_packages op
     INNER JOIN packages p ON p.id = op.package_id
     WHERE op.operator_id = ?
     ORDER BY p.name ASC`,
    [operatorId]
  );
}

export async function getOperatorPackageIds(operatorId, { activeOnly = true, connection = null } = {}) {
  const packages = await getOperatorPackages(operatorId, { connection });
  const filtered = activeOnly ? packages.filter((pkg) => pkg.is_active) : packages;
  return filtered.map((pkg) => pkg.id);
}

export async function syncOperatorPackages(operatorId, packageIds, connection = null) {
  const uniqueIds = [...new Set(packageIds.map((id) => Number(id)).filter(Boolean))];
  const runner = connection
    ? (sql, params) => connection.execute(sql, params)
    : (sql, params) => query(sql, params);

  await runner('DELETE FROM operator_packages WHERE operator_id = ?', [operatorId]);

  for (const packageId of uniqueIds) {
    await runner('INSERT INTO operator_packages (operator_id, package_id) VALUES (?, ?)', [
      operatorId,
      packageId,
    ]);
  }
}

export async function getOperatorPackagesByOperatorIds(operatorIds = []) {
  if (!operatorIds.length) return new Map();

  const placeholders = operatorIds.map(() => '?').join(', ');
  const rows = await query(
    `SELECT op.operator_id, p.id, p.name, p.sku, p.price_amount, p.currency_code, p.is_active
     FROM operator_packages op
     INNER JOIN packages p ON p.id = op.package_id
     WHERE op.operator_id IN (${placeholders})
     ORDER BY p.name ASC`,
    operatorIds
  );

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.operator_id)) map.set(row.operator_id, []);
    map.get(row.operator_id).push({
      id: row.id,
      name: row.name,
      sku: row.sku,
      priceAmount: Number(row.price_amount),
      currencyCode: row.currency_code,
      isActive: Boolean(row.is_active),
    });
  }
  return map;
}

export async function updatePackageStatus(adminId, packageId, isActive, reqMeta = {}) {
  const pkg = await getPackageById(packageId);
  if (!pkg) {
    throw new AppError('Package not found', 404, 'NOT_FOUND');
  }

  if (!isActive) {
    const [inUse] = await query(
      `SELECT COUNT(*) AS total FROM operator_packages op
       INNER JOIN operators o ON o.id = op.operator_id
       WHERE op.package_id = ? AND o.is_active = 1`,
      [packageId]
    );
    if (Number(inUse.total) > 0) {
      throw new AppError(
        'Cannot deactivate a package assigned to active operators',
        400,
        'PACKAGE_IN_USE'
      );
    }
  }

  await query('UPDATE packages SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, packageId]);

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: isActive ? 'PACKAGE_ACTIVATED' : 'PACKAGE_DEACTIVATED',
    resourceType: 'package',
    resourceId: packageId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
  });

  return { id: packageId, isActive };
}
