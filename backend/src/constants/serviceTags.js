import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';

/*
 * Customer (service) types are rows in `service_types`, managed by staff. They are read
 * through a short-lived in-memory copy so the synchronous helpers below keep working in
 * hot paths; `ensureServiceTypesLoaded()` refreshes it and runs as router middleware.
 * The built-in OTT and MEDIANET_TV rows fall back to the .env CRM ids until staff set them.
 */
const CACHE_TTL_MS = 15 * 1000;

const BUILT_IN_FALLBACKS = {
  OTT: () => ({ crmTagId: config.crm.defaultTagId, crmDeviceProductId: config.crm.deviceProductId }),
  MEDIANET_TV: () => ({
    crmTagId: config.crm.medianetTvTagId,
    crmDeviceProductId: config.crm.medianetTvDeviceProductId,
  }),
};

// Used only until the first database load (and by tooling that runs without a database).
let serviceTypes = new Map([
  ['OTT', { key: 'OTT', label: 'Mobile (OTT)', shortLabel: 'Mobile', crmTagName: 'OTT', crmPriceSegmentName: 'OTT', isActive: true, sortOrder: 1 }],
  ['MEDIANET_TV', { key: 'MEDIANET_TV', label: 'TV (Medianet TV)', shortLabel: 'TV', crmTagName: 'Medianet TV', crmPriceSegmentName: null, isActive: true, sortOrder: 2 }],
]);
let loadedAt = 0;
let loading = null;

function mapRow(row) {
  return {
    id: row.id,
    key: row.type_key,
    label: row.label,
    shortLabel: row.short_label,
    crmTagId: row.crm_tag_id || null,
    crmTagName: row.crm_tag_name,
    crmDeviceProductId: row.crm_device_product_id || null,
    crmPriceSegmentName: row.crm_price_segment_name || null,
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order) || 0,
  };
}

export async function reloadServiceTypes() {
  const rows = await query(
    `SELECT id, type_key, label, short_label, crm_tag_id, crm_tag_name, crm_device_product_id,
            crm_price_segment_name, is_active, sort_order
     FROM service_types
     ORDER BY sort_order ASC, label ASC`
  );
  serviceTypes = new Map(rows.map((row) => [row.type_key, mapRow(row)]));
  loadedAt = Date.now();
}

/** Refreshes the in-memory copy when it is stale. Concurrent callers share one query. */
export async function ensureServiceTypesLoaded() {
  if (Date.now() - loadedAt < CACHE_TTL_MS) return;
  if (!loading) {
    loading = reloadServiceTypes().finally(() => {
      loading = null;
    });
  }
  await loading;
}

/** Express middleware: keeps the service type list fresh for the request. */
export function refreshServiceTypes(_req, _res, next) {
  ensureServiceTypesLoaded().then(() => next(), next);
}

export function listServiceTypes({ activeOnly = false } = {}) {
  const all = [...serviceTypes.values()];
  return activeOnly ? all.filter((type) => type.isActive) : all;
}

/** Labels only: safe to send to any signed-in user. */
export function listServiceTypesPublic() {
  return listServiceTypes().map(({ key, label, shortLabel, isActive }) => ({ key, label, shortLabel, isActive }));
}

export function getServiceTypeLabel(serviceTag) {
  return serviceTypes.get(serviceTag)?.label || serviceTag;
}

/** The type must exist and be active. Returns the key. */
export function assertServiceTag(serviceTag) {
  const type = serviceTypes.get(serviceTag);
  if (!type || !type.isActive) {
    throw new AppError('Invalid or inactive customer type', 400, 'VALIDATION_ERROR');
  }
  return serviceTag;
}

/** CRM settings for a type: tag, device product and price segment. */
export function getServiceTagConfig(serviceTag) {
  const type = serviceTypes.get(serviceTag);
  if (!type) {
    throw new AppError('Invalid service tag', 400, 'VALIDATION_ERROR');
  }

  const fallback = BUILT_IN_FALLBACKS[serviceTag]?.() || {};
  const crmTagId = type.crmTagId || fallback.crmTagId;
  const crmDeviceProductId = type.crmDeviceProductId || fallback.crmDeviceProductId;

  if (!crmTagId) {
    throw new AppError(`Service tag is not configured for ${type.label}`, 503, 'CRM_NOT_CONFIGURED');
  }
  if (!crmDeviceProductId) {
    throw new AppError(`Device type is not configured for ${type.label}`, 503, 'CRM_NOT_CONFIGURED');
  }

  return { ...type, crmTagId, crmDeviceProductId };
}

/** Every package must belong to one of the allowed customer types. */
export function assertPackagesMatchServiceTypes(plans = [], allowedKeys = []) {
  const allowed = new Set(allowedKeys);
  for (const plan of plans) {
    const tag = plan.serviceTag || plan.service_tag || 'OTT';
    if (!allowed.has(tag)) {
      throw new AppError(
        `Package "${plan.name}" is for ${getServiceTypeLabel(tag)} customers, which this operator is not allowed to serve`,
        400,
        'PACKAGE_SCOPE_MISMATCH'
      );
    }
  }
}

/** Value for the legacy operators.service_scope column (kept for old reports only). */
export function legacyServiceScope(keys = []) {
  if (keys.length === 1 && (keys[0] === 'OTT' || keys[0] === 'MEDIANET_TV')) return keys[0];
  return 'BOTH';
}
