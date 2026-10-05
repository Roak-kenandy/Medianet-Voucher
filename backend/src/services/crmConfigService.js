import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { logAudit } from './auditService.js';
import { reloadAppSettings } from './appSettingsService.js';
import {
  ensureServiceTypesLoaded,
  listServiceTypes,
  reloadServiceTypes,
} from '../constants/serviceTags.js';

function uniqueNumbers(ids = []) {
  return [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Customer (service) types
// ---------------------------------------------------------------------------

function serviceTypeForStaff(type) {
  // CRM ids come from .env for the two built-in types until staff set them here.
  const envFallback =
    type.key === 'OTT'
      ? { crmTagId: config.crm.defaultTagId, crmDeviceProductId: config.crm.deviceProductId }
      : type.key === 'MEDIANET_TV'
        ? { crmTagId: config.crm.medianetTvTagId, crmDeviceProductId: config.crm.medianetTvDeviceProductId }
        : {};
  return {
    ...type,
    usesEnvTagId: !type.crmTagId && Boolean(envFallback.crmTagId),
    usesEnvDeviceProductId: !type.crmDeviceProductId && Boolean(envFallback.crmDeviceProductId),
    effectiveCrmTagId: type.crmTagId || envFallback.crmTagId || null,
    effectiveCrmDeviceProductId: type.crmDeviceProductId || envFallback.crmDeviceProductId || null,
  };
}

export async function listServiceTypesForStaff() {
  await reloadServiceTypes();
  const usage = await query(
    `SELECT st.type_key,
            (SELECT COUNT(*) FROM operator_service_types ost WHERE ost.service_type_key = st.type_key) AS operators,
            (SELECT COUNT(*) FROM packages p WHERE p.service_tag = st.type_key) AS packages
     FROM service_types st`
  );
  const usageByKey = new Map(usage.map((row) => [row.type_key, row]));
  return listServiceTypes().map((type) => ({
    ...serviceTypeForStaff(type),
    operatorCount: Number(usageByKey.get(type.key)?.operators) || 0,
    packageCount: Number(usageByKey.get(type.key)?.packages) || 0,
  }));
}

export async function createServiceType(adminId, data, reqMeta = {}) {
  const key = data.key.trim().toUpperCase();
  const existing = await query('SELECT id FROM service_types WHERE type_key = ? LIMIT 1', [key]);
  if (existing.length) {
    throw new AppError('A customer type with this key already exists', 409, 'SERVICE_TYPE_EXISTS');
  }

  const [order] = await query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM service_types');
  const result = await query(
    `INSERT INTO service_types
       (type_key, label, short_label, crm_tag_id, crm_tag_name, crm_device_product_id, crm_price_segment_name, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      key,
      data.label.trim(),
      data.shortLabel.trim(),
      data.crmTagId,
      data.crmTagName.trim(),
      data.crmDeviceProductId,
      data.crmPriceSegmentName?.trim() || null,
      Number(order.next) || 1,
    ]
  );
  await reloadServiceTypes();

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'SERVICE_TYPE_CREATED',
    resourceType: 'service_type',
    resourceId: result.insertId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { key, label: data.label.trim(), crmTagName: data.crmTagName.trim() },
  });

  return (await listServiceTypesForStaff()).find((type) => type.key === key);
}

/** The key never changes: packages, accounts and operator allow-lists refer to it. */
export async function updateServiceType(adminId, key, data, reqMeta = {}) {
  const [current] = await query('SELECT id, is_active FROM service_types WHERE type_key = ? LIMIT 1', [key]);
  if (!current) {
    throw new AppError('Customer type not found', 404, 'NOT_FOUND');
  }

  await query(
    `UPDATE service_types
     SET label = ?, short_label = ?, crm_tag_id = ?, crm_tag_name = ?, crm_device_product_id = ?,
         crm_price_segment_name = ?, is_active = ?
     WHERE type_key = ?`,
    [
      data.label.trim(),
      data.shortLabel.trim(),
      data.crmTagId || null,
      data.crmTagName.trim(),
      data.crmDeviceProductId || null,
      data.crmPriceSegmentName?.trim() || null,
      data.isActive ? 1 : 0,
      key,
    ]
  );
  await reloadServiceTypes();

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'SERVICE_TYPE_UPDATED',
    resourceType: 'service_type',
    resourceId: current.id,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { key, label: data.label.trim(), crmTagName: data.crmTagName.trim(), isActive: Boolean(data.isActive) },
  });

  return (await listServiceTypesForStaff()).find((type) => type.key === key);
}

/** Validates the keys exist and are active; returns them in display order, default first. */
export async function resolveServiceTypeKeys(keys = [], defaultKey = null) {
  await ensureServiceTypesLoaded();
  const requested = [...new Set((keys || []).map((key) => String(key)))];
  if (!requested.length) {
    throw new AppError('Select at least one customer type', 400, 'VALIDATION_ERROR');
  }
  const active = new Map(listServiceTypes({ activeOnly: true }).map((type) => [type.key, type]));
  const unknown = requested.filter((key) => !active.has(key));
  if (unknown.length) {
    throw new AppError(`Unknown or inactive customer type: ${unknown.join(', ')}`, 400, 'VALIDATION_ERROR');
  }
  const ordered = [...active.keys()].filter((key) => requested.includes(key));
  const resolvedDefault = defaultKey && ordered.includes(defaultKey) ? defaultKey : ordered[0];
  return { keys: ordered, defaultKey: resolvedDefault };
}

export async function syncOperatorServiceTypes(connection, operatorId, keys, defaultKey) {
  await connection.execute('DELETE FROM operator_service_types WHERE operator_id = ?', [operatorId]);
  for (const key of keys) {
    await connection.execute(
      'INSERT INTO operator_service_types (operator_id, service_type_key, is_default) VALUES (?, ?, ?)',
      [operatorId, key, key === defaultKey ? 1 : 0]
    );
  }
}

/** Customer types an operator may serve, default first, limited to active types. */
export async function getOperatorServiceTypeKeys(operatorId, { connection = null } = {}) {
  const runner = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : query;
  const rows = await runner(
    `SELECT ost.service_type_key
     FROM operator_service_types ost
     INNER JOIN service_types st ON st.type_key = ost.service_type_key AND st.is_active = 1
     WHERE ost.operator_id = ?
     ORDER BY ost.is_default DESC, st.sort_order ASC`,
    [operatorId]
  );
  return rows.map((row) => row.service_type_key);
}

export async function getServiceTypeKeysByOperatorIds(operatorIds = []) {
  if (!operatorIds.length) return new Map();
  const placeholders = operatorIds.map(() => '?').join(', ');
  const rows = await query(
    `SELECT ost.operator_id, ost.service_type_key, ost.is_default
     FROM operator_service_types ost
     INNER JOIN service_types st ON st.type_key = ost.service_type_key
     WHERE ost.operator_id IN (${placeholders})
     ORDER BY ost.is_default DESC, st.sort_order ASC`,
    operatorIds
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.operator_id)) map.set(row.operator_id, { keys: [], defaultKey: null });
    const entry = map.get(row.operator_id);
    entry.keys.push(row.service_type_key);
    if (row.is_default && !entry.defaultKey) entry.defaultKey = row.service_type_key;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Sales models
// ---------------------------------------------------------------------------

function mapSalesModel(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: Boolean(row.is_active),
    packageCount: Number(row.package_count) || 0,
    operatorCount: Number(row.operator_count) || 0,
  };
}

export async function listSalesModels({ activeOnly = false } = {}) {
  const rows = await query(
    `SELECT sm.id, sm.name, sm.description, sm.is_active,
            (SELECT COUNT(*) FROM packages p WHERE p.sales_model_id = sm.id) AS package_count,
            (SELECT COUNT(*) FROM operator_sales_models osm WHERE osm.sales_model_id = sm.id) AS operator_count
     FROM sales_models sm
     ${activeOnly ? 'WHERE sm.is_active = 1' : ''}
     ORDER BY sm.name ASC`
  );
  return rows.map(mapSalesModel);
}

export async function getSalesModelOrThrow(salesModelId, { activeOnly = false } = {}) {
  const [row] = await query('SELECT id, name, description, is_active FROM sales_models WHERE id = ? LIMIT 1', [
    salesModelId,
  ]);
  if (!row || (activeOnly && !row.is_active)) {
    throw new AppError('Sales model not found or inactive', 400, 'SALES_MODEL_NOT_FOUND');
  }
  return mapSalesModel(row);
}

export async function createSalesModel(adminId, data, reqMeta = {}) {
  const name = data.name.trim();
  const existing = await query('SELECT id FROM sales_models WHERE name = ? LIMIT 1', [name]);
  if (existing.length) {
    throw new AppError('A sales model with this name already exists', 409, 'SALES_MODEL_EXISTS');
  }
  const result = await query('INSERT INTO sales_models (name, description) VALUES (?, ?)', [
    name,
    data.description?.trim() || null,
  ]);

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'SALES_MODEL_CREATED',
    resourceType: 'sales_model',
    resourceId: result.insertId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { name },
  });

  return getSalesModelOrThrow(result.insertId);
}

/**
 * The name must match the sales model name in CRM exactly; it is what the catalog is
 * filtered by. Renaming does not change the prices already stored on packages.
 */
export async function updateSalesModel(adminId, salesModelId, data, reqMeta = {}) {
  await getSalesModelOrThrow(salesModelId);
  const name = data.name.trim();
  const clash = await query('SELECT id FROM sales_models WHERE name = ? AND id != ? LIMIT 1', [name, salesModelId]);
  if (clash.length) {
    throw new AppError('A sales model with this name already exists', 409, 'SALES_MODEL_EXISTS');
  }

  await query('UPDATE sales_models SET name = ?, description = ?, is_active = ? WHERE id = ?', [
    name,
    data.description?.trim() || null,
    data.isActive ? 1 : 0,
    salesModelId,
  ]);

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'SALES_MODEL_UPDATED',
    resourceType: 'sales_model',
    resourceId: Number(salesModelId),
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { name, isActive: Boolean(data.isActive) },
  });

  return (await listSalesModels()).find((model) => model.id === Number(salesModelId));
}

/** Validates the ids exist and are active; returns the ids. */
export async function resolveSalesModelIds(ids = []) {
  const requested = uniqueNumbers(ids);
  if (!requested.length) {
    throw new AppError('Select at least one sales model', 400, 'VALIDATION_ERROR');
  }
  const placeholders = requested.map(() => '?').join(', ');
  const rows = await query(
    `SELECT id FROM sales_models WHERE is_active = 1 AND id IN (${placeholders})`,
    requested
  );
  if (rows.length !== requested.length) {
    throw new AppError('One or more sales models do not exist or are inactive', 400, 'SALES_MODEL_NOT_FOUND');
  }
  return requested;
}

export async function syncOperatorSalesModels(connection, operatorId, salesModelIds) {
  await connection.execute('DELETE FROM operator_sales_models WHERE operator_id = ?', [operatorId]);
  for (const salesModelId of uniqueNumbers(salesModelIds)) {
    await connection.execute('INSERT INTO operator_sales_models (operator_id, sales_model_id) VALUES (?, ?)', [
      operatorId,
      salesModelId,
    ]);
  }
}

export async function getSalesModelIdsByOperatorIds(operatorIds = []) {
  if (!operatorIds.length) return new Map();
  const placeholders = operatorIds.map(() => '?').join(', ');
  const rows = await query(
    `SELECT osm.operator_id, sm.id, sm.name
     FROM operator_sales_models osm
     INNER JOIN sales_models sm ON sm.id = osm.sales_model_id
     WHERE osm.operator_id IN (${placeholders})
     ORDER BY sm.name ASC`,
    operatorIds
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.operator_id)) map.set(row.operator_id, []);
    map.get(row.operator_id).push({ id: row.id, name: row.name });
  }
  return map;
}

/** Each package's sales model must be on the operator's allow-list. */
export function assertPackagesMatchSalesModels(plans = [], allowedSalesModelIds = []) {
  const allowed = new Set(allowedSalesModelIds.map(Number));
  for (const plan of plans) {
    if (plan.salesModelId != null && !allowed.has(Number(plan.salesModelId))) {
      throw new AppError(
        `Package "${plan.name}" uses the ${plan.salesModelName || 'another'} sales model, which this operator is not allowed`,
        400,
        'PACKAGE_SALES_MODEL_MISMATCH'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// One-time defaults from .env (safe to run on every start)
// ---------------------------------------------------------------------------

/**
 * Carries the old single-sales-model setup over: the .env sales model becomes the first row,
 * packages without a sales model get it, and operators without an allow-list get every
 * existing model so nothing they could sell before disappears.
 */
export async function bootstrapCrmConfig() {
  const defaultName = (config.crm.salesModelName || 'Retail').trim();
  const models = await query('SELECT id FROM sales_models LIMIT 1');
  if (!models.length) {
    await query('INSERT IGNORE INTO sales_models (name, description) VALUES (?, ?)', [
      defaultName,
      'Created from CRM_SALES_MODEL_NAME',
    ]);
  }

  const [fallback] = await query(
    'SELECT id FROM sales_models ORDER BY (name = ?) DESC, id ASC LIMIT 1',
    [defaultName]
  );
  if (fallback) {
    await query('UPDATE packages SET sales_model_id = ? WHERE sales_model_id IS NULL', [fallback.id]);
  }

  await query(
    `INSERT IGNORE INTO operator_sales_models (operator_id, sales_model_id)
     SELECT o.id, sm.id
     FROM operators o
     CROSS JOIN sales_models sm
     WHERE NOT EXISTS (SELECT 1 FROM operator_sales_models x WHERE x.operator_id = o.id)`
  );

  await reloadServiceTypes();
  await reloadAppSettings();
}
