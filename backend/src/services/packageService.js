import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { logAudit } from './auditService.js';
import { paginationSql } from '../utils/pagination.js';
import { assertServiceTag, ensureServiceTypesLoaded } from '../constants/serviceTags.js';

export async function listPackages({ page = 1, limit = 20, search = '', activeOnly = false } = {}) {
  const { page: pageNum, limit: limitNum, clause } = paginationSql(page, limit);
  const filters = [];
  const params = [];

  if (activeOnly) {
    filters.push('p.is_active = 1');
  }

  if (search) {
    filters.push('(p.name LIKE ? OR p.sku LIKE ? OR p.product_id LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const packages = await query(
    `SELECT p.id, p.name, p.service_tag, p.sales_model_id, sm.name AS sales_model_name, p.sku,
            p.package_role, p.upgrade_family, p.upgrade_tier,
            p.product_id, p.price_term_id, p.price_amount, p.currency_code,
            p.description, p.is_active, p.created_at, p.updated_at
     FROM packages p
     LEFT JOIN sales_models sm ON sm.id = p.sales_model_id
     ${where}
     ORDER BY p.name ASC
     ${clause}`,
    params
  );

  const [countRow] = await query(`SELECT COUNT(*) AS total FROM packages p ${where}`, params);
  const total = Number(countRow.total) || 0;
  await attachRequirements(packages);

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
    `SELECT p.id, p.name, p.service_tag, p.sales_model_id, sm.name AS sales_model_name, p.sku,
            p.package_role, p.upgrade_family, p.upgrade_tier,
            p.product_id, p.price_term_id, p.price_amount, p.currency_code, p.description
     FROM packages p
     LEFT JOIN sales_models sm ON sm.id = p.sales_model_id
     WHERE p.is_active = 1
     ORDER BY p.name ASC`
  );
}

export async function getPackageById(packageId) {
  const [pkg] = await query(
    `SELECT p.id, p.name, p.service_tag, p.sales_model_id, sm.name AS sales_model_name, p.sku,
            p.package_role, p.upgrade_family, p.upgrade_tier,
            p.product_id, p.price_term_id, p.price_amount, p.currency_code, p.description, p.is_active
     FROM packages p
     LEFT JOIN sales_models sm ON sm.id = p.sales_model_id
     WHERE p.id = ? LIMIT 1`,
    [packageId]
  );
  if (pkg) await attachRequirements([pkg]);
  return pkg || null;
}

/** Adds `required_package_ids` (what an add-on needs) to each package row. */
async function attachRequirements(packages = []) {
  for (const pkg of packages) pkg.required_package_ids = [];
  if (!packages.length) return packages;
  const placeholders = packages.map(() => '?').join(', ');
  const rows = await query(
    `SELECT package_id, required_package_id FROM package_requirements WHERE package_id IN (${placeholders})`,
    packages.map((pkg) => pkg.id)
  );
  const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
  for (const row of rows) byId.get(row.package_id)?.required_package_ids.push(row.required_package_id);
  return packages;
}

/**
 * Normalises the eligibility fields: a base plan has a family and a tier, an add-on has
 * required base packages, and a standalone package has neither.
 */
async function resolveEligibilityFields(data, packageId = null) {
  const role = data.packageRole === 'base' || data.packageRole === 'addon' ? data.packageRole : 'standalone';
  if (role === 'base') {
    const family = String(data.upgradeFamily || '').trim();
    const tier = Number(data.upgradeTier);
    if (!family) {
      throw new AppError('A base package needs an upgrade family', 400, 'VALIDATION_ERROR');
    }
    if (!Number.isInteger(tier) || tier < 1) {
      throw new AppError('A base package needs a tier of 1 or higher', 400, 'VALIDATION_ERROR');
    }
    return { role, family, tier, requiredPackageIds: [] };
  }
  if (role === 'addon') {
    const requiredIds = [...new Set((data.requiredPackageIds || []).map(Number).filter(Boolean))].filter(
      (id) => id !== Number(packageId)
    );
    if (!requiredIds.length) {
      throw new AppError('An add-on needs at least one base package it can be sold with', 400, 'VALIDATION_ERROR');
    }
    const placeholders = requiredIds.map(() => '?').join(', ');
    const rows = await query(
      `SELECT id FROM packages WHERE package_role = 'base' AND id IN (${placeholders})`,
      requiredIds
    );
    if (rows.length !== requiredIds.length) {
      throw new AppError('An add-on can only require base packages', 400, 'VALIDATION_ERROR');
    }
    return { role, family: null, tier: null, requiredPackageIds: requiredIds };
  }
  return { role, family: null, tier: null, requiredPackageIds: [] };
}

async function saveRequirements(packageId, requiredPackageIds) {
  await query('DELETE FROM package_requirements WHERE package_id = ?', [packageId]);
  for (const requiredId of requiredPackageIds) {
    await query('INSERT INTO package_requirements (package_id, required_package_id) VALUES (?, ?)', [
      packageId,
      requiredId,
    ]);
  }
}

/**
 * Every package of a customer type in the shape the eligibility rules use. Inactive packages
 * are included so a service the customer already holds is still recognised.
 */
export async function getPackageCatalog(serviceTag) {
  const rows = await query(
    `SELECT id, name, package_role, upgrade_family, upgrade_tier, product_id, is_active
     FROM packages WHERE service_tag = ?`,
    [serviceTag]
  );
  await attachRequirements(rows);
  return rows.map(toEligibilityPackage);
}

export function toEligibilityPackage(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.package_role || 'standalone',
    family: row.upgrade_family || null,
    tier: row.upgrade_tier ?? null,
    productId: row.product_id,
    requiredPackageIds: row.required_package_ids || [],
  };
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
    serviceTag: pkg.service_tag || 'OTT',
    salesModelId: pkg.sales_model_id ?? null,
    salesModelName: pkg.sales_model_name || null,
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
  await ensureServiceTypesLoaded();
  const serviceTag = assertServiceTag(data.serviceTag || 'OTT');
  const [salesModel] = await query(
    'SELECT id, name FROM sales_models WHERE id = ? AND is_active = 1 LIMIT 1',
    [data.salesModelId]
  );
  if (!salesModel) {
    throw new AppError('Select an active sales model for this package', 400, 'SALES_MODEL_NOT_FOUND');
  }

  const eligibility = await resolveEligibilityFields(data);

  const existing = await query(
    `SELECT id FROM packages WHERE product_id = ? AND price_term_id = ? LIMIT 1`,
    [data.productId, data.priceTermId]
  );

  if (existing.length) {
    throw new AppError('This product and price combination already exists', 409, 'PACKAGE_EXISTS');
  }

  const result = await query(
    `INSERT INTO packages
       (name, service_tag, sales_model_id, package_role, upgrade_family, upgrade_tier,
        sku, product_id, price_term_id, price_amount, currency_code, description, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name.trim(),
      serviceTag,
      salesModel.id,
      eligibility.role,
      eligibility.family,
      eligibility.tier,
      data.sku?.trim() || null,
      data.productId,
      data.priceTermId,
      data.priceAmount,
      data.currencyCode || 'MVR',
      data.description?.trim() || null,
      adminId,
    ]
  );

  await saveRequirements(result.insertId, eligibility.requiredPackageIds);

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'PACKAGE_CREATED',
    resourceType: 'package',
    resourceId: result.insertId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: {
      name: data.name,
      productId: data.productId,
      priceTermId: data.priceTermId,
      serviceTag,
      salesModel: salesModel.name,
    },
  });

  return getPackageById(result.insertId);
}

/**
 * Edits a package. The price is what operators are charged and what is posted to CRM as the
 * payment, and the product and price term are what CRM subscribes the customer to, so a
 * change here applies to every sale made after it. Past sales keep the amount they were
 * charged at the time.
 */
export async function updatePackage(adminId, packageId, data, reqMeta = {}) {
  const current = await getPackageById(packageId);
  if (!current) {
    throw new AppError('Package not found', 404, 'NOT_FOUND');
  }

  await ensureServiceTypesLoaded();
  // An unchanged type may already be inactive; only a newly chosen one must be active.
  const serviceTag =
    data.serviceTag === current.service_tag ? current.service_tag : assertServiceTag(data.serviceTag);

  const [salesModel] = await query('SELECT id, name, is_active FROM sales_models WHERE id = ? LIMIT 1', [
    data.salesModelId,
  ]);
  if (!salesModel || (!salesModel.is_active && salesModel.id !== current.sales_model_id)) {
    throw new AppError('Select an active sales model for this package', 400, 'SALES_MODEL_NOT_FOUND');
  }

  const eligibility = await resolveEligibilityFields(data, packageId);

  const clash = await query(
    `SELECT id FROM packages WHERE product_id = ? AND price_term_id = ? AND id != ? LIMIT 1`,
    [data.productId, data.priceTermId, packageId]
  );
  if (clash.length) {
    throw new AppError('Another package already uses this product and price term', 409, 'PACKAGE_EXISTS');
  }

  await query(
    `UPDATE packages
     SET name = ?, service_tag = ?, sales_model_id = ?,
         package_role = ?, upgrade_family = ?, upgrade_tier = ?, sku = ?, description = ?,
         product_id = ?, price_term_id = ?, price_amount = ?, currency_code = ?
     WHERE id = ?`,
    [
      data.name.trim(),
      serviceTag,
      salesModel.id,
      eligibility.role,
      eligibility.family,
      eligibility.tier,
      data.sku?.trim() || null,
      data.description?.trim() || null,
      data.productId,
      data.priceTermId,
      data.priceAmount,
      data.currencyCode || current.currency_code || 'MVR',
      packageId,
    ]
  );

  await saveRequirements(packageId, eligibility.requiredPackageIds);

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'PACKAGE_UPDATED',
    resourceType: 'package',
    resourceId: packageId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: {
      name: data.name.trim(),
      serviceTag,
      previousServiceTag: current.service_tag,
      salesModel: salesModel.name,
      previousSalesModelId: current.sales_model_id,
      productId: data.productId,
      previousProductId: current.product_id,
      priceTermId: data.priceTermId,
      previousPriceTermId: current.price_term_id,
      priceAmount: Number(data.priceAmount),
      previousPriceAmount: Number(current.price_amount),
      packageRole: eligibility.role,
      upgradeFamily: eligibility.family,
      upgradeTier: eligibility.tier,
      requiredPackageIds: eligibility.requiredPackageIds,
    },
  });

  return getPackageById(packageId);
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

/*
 * An operator's packages come from two places: packages assigned to it individually
 * (operator_packages) and packages of the groups it belongs to (operator_package_groups →
 * package_group_items). Group packages for customer types the operator does not serve are
 * ignored, so one group can be shared by operators with different customer types. In both
 * cases the package's sales model must be on the operator's sales model allow-list.
 */
const EFFECTIVE_PACKAGE_SOURCES = `
  SELECT op.operator_id, op.package_id, 1 AS is_direct, NULL AS group_id
  FROM operator_packages op
  INNER JOIN packages dp ON dp.id = op.package_id
  WHERE dp.sales_model_id IS NULL OR EXISTS (
    SELECT 1 FROM operator_sales_models osm
    WHERE osm.operator_id = op.operator_id AND osm.sales_model_id = dp.sales_model_id
  )
  UNION ALL
  SELECT og.operator_id, gi.package_id, 0 AS is_direct, og.group_id
  FROM operator_package_groups og
  INNER JOIN package_group_items gi ON gi.group_id = og.group_id
  INNER JOIN packages gp ON gp.id = gi.package_id
  INNER JOIN operator_service_types ost
    ON ost.operator_id = og.operator_id AND ost.service_type_key = COALESCE(gp.service_tag, 'OTT')
  WHERE gp.sales_model_id IS NULL OR EXISTS (
    SELECT 1 FROM operator_sales_models osm
    WHERE osm.operator_id = og.operator_id AND osm.sales_model_id = gp.sales_model_id
  )`;

/** Every package the operator may sell: individually assigned plus inherited from groups. */
export async function getOperatorPackages(operatorId, { connection = null } = {}) {
  const runner = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : query;

  return runner(
    `SELECT p.id, p.name, p.service_tag, p.sales_model_id, p.sku, p.product_id, p.price_term_id,
            p.package_role, p.upgrade_family, p.upgrade_tier,
            p.price_amount, p.currency_code, p.is_active, MAX(src.is_direct) AS is_direct
     FROM (${EFFECTIVE_PACKAGE_SOURCES}) src
     INNER JOIN packages p ON p.id = src.package_id
     WHERE src.operator_id = ?
     GROUP BY p.id, p.name, p.service_tag, p.sales_model_id, p.sku, p.product_id, p.price_term_id,
              p.package_role, p.upgrade_family, p.upgrade_tier,
              p.price_amount, p.currency_code, p.is_active
     ORDER BY p.name ASC`,
    [operatorId]
  );
}

export async function getOperatorPackageIds(operatorId, { activeOnly = true, connection = null } = {}) {
  const packages = await getOperatorPackages(operatorId, { connection });
  const filtered = activeOnly ? packages.filter((pkg) => pkg.is_active) : packages;
  return filtered.map((pkg) => pkg.id);
}

export async function sumPackagePrices(packageIds = [], { connection = null } = {}) {
  const uniqueIds = [...new Set(packageIds.map((id) => Number(id)).filter(Boolean))];
  if (!uniqueIds.length) {
    return { total: 0, currencyCode: 'MVR', packages: [] };
  }

  const runner = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : query;

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = await runner(
    `SELECT id, name, price_amount, currency_code, is_active
     FROM packages
     WHERE id IN (${placeholders})`,
    uniqueIds
  );

  if (rows.length !== uniqueIds.length) {
    throw new AppError('One or more packages are invalid', 400, 'PACKAGE_NOT_FOUND');
  }

  const inactive = rows.filter((row) => !row.is_active);
  if (inactive.length) {
    throw new AppError('One or more packages are inactive', 400, 'PACKAGE_INACTIVE');
  }

  const total = rows.reduce((sum, row) => sum + Number(row.price_amount), 0);

  return {
    total: Math.round(total * 100) / 100,
    currencyCode: rows[0]?.currency_code || 'MVR',
    packages: rows.map((row) => ({
      id: row.id,
      name: row.name,
      priceAmount: Number(row.price_amount),
      currencyCode: row.currency_code,
    })),
  };
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

/**
 * Effective packages for several operators at once (admin list). Each package says whether
 * it is assigned individually (`direct`) and which of the operator's groups supply it.
 */
export async function getOperatorPackagesByOperatorIds(operatorIds = []) {
  if (!operatorIds.length) return new Map();

  const placeholders = operatorIds.map(() => '?').join(', ');
  const rows = await query(
    `SELECT src.operator_id, src.is_direct, src.group_id,
            p.id, p.name, p.service_tag, p.sales_model_id, p.sku, p.price_amount, p.currency_code, p.is_active
     FROM (${EFFECTIVE_PACKAGE_SOURCES}) src
     INNER JOIN packages p ON p.id = src.package_id
     WHERE src.operator_id IN (${placeholders})
     ORDER BY p.name ASC`,
    operatorIds
  );

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.operator_id)) map.set(row.operator_id, new Map());
    const byPackage = map.get(row.operator_id);
    if (!byPackage.has(row.id)) {
      byPackage.set(row.id, {
        id: row.id,
        name: row.name,
        serviceTag: row.service_tag || 'OTT',
        salesModelId: row.sales_model_id ?? null,
        sku: row.sku,
        priceAmount: Number(row.price_amount),
        currencyCode: row.currency_code,
        isActive: Boolean(row.is_active),
        direct: false,
        groupIds: [],
      });
    }
    const entry = byPackage.get(row.id);
    if (Number(row.is_direct) === 1) entry.direct = true;
    else if (row.group_id != null && !entry.groupIds.includes(row.group_id)) entry.groupIds.push(row.group_id);
  }

  return new Map([...map].map(([operatorId, byPackage]) => [operatorId, [...byPackage.values()]]));
}

export async function updatePackageStatus(adminId, packageId, isActive, reqMeta = {}) {
  const pkg = await getPackageById(packageId);
  if (!pkg) {
    throw new AppError('Package not found', 404, 'NOT_FOUND');
  }

  if (!isActive) {
    const [inUse] = await query(
      `SELECT COUNT(DISTINCT src.operator_id) AS total
       FROM (${EFFECTIVE_PACKAGE_SOURCES}) src
       INNER JOIN operators o ON o.id = src.operator_id
       WHERE src.package_id = ? AND o.is_active = 1`,
      [packageId]
    );
    if (Number(inUse.total) > 0) {
      throw new AppError(
        'Cannot deactivate a package that active operators have, directly or through a package group',
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
