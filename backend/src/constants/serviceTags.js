import { config } from '../config/index.js';
import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { activeCrmEnvironment } from '../utils/crmEnvironment.js';

/*
 * Customer (service) types are rows in `service_types`, managed by staff. They are read
 * through a short-lived in-memory copy so the synchronous helpers below keep working in
 * hot paths; `ensureServiceTypesLoaded()` refreshes it and runs as router middleware.
 * The built-in live OTT and MEDIANET_TV rows fall back to the .env CRM ids until staff set them.
 *
 * A key is unique within one CRM environment, so the same key (say OTT) can exist in live and
 * in sandbox. Lookups take the environment; when it is left out they use the one selected by
 * `runInCrmEnvironment`, or live outside it.
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
  ['live:OTT', { key: 'OTT', label: 'Mobile (OTT)', shortLabel: 'Mobile', crmTagName: 'OTT', crmPriceSegmentName: 'OTT', isActive: true, sortOrder: 1, environment: 'live' }],
  ['live:MEDIANET_TV', { key: 'MEDIANET_TV', label: 'TV (Medianet TV)', shortLabel: 'TV', crmTagName: 'Medianet TV', crmPriceSegmentName: null, isActive: true, sortOrder: 2, environment: 'live' }],
]);
let loadedAt = 0;

function findType(serviceTag, environment) {
  return serviceTypes.get(`${environment || activeCrmEnvironment() || 'live'}:${serviceTag}`);
}

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
    // Which CRM this type's ids belong to: `live` or `sandbox`.
    environment: row.environment || 'live',
  };
}

export async function reloadServiceTypes() {
  const rows = await query(
    `SELECT id, type_key, label, short_label, crm_tag_id, crm_tag_name, crm_device_product_id,
            crm_price_segment_name, is_active, sort_order, environment
     FROM service_types
     ORDER BY sort_order ASC, label ASC`
  );
  serviceTypes = new Map(rows.map((row) => [`${row.environment || 'live'}:${row.type_key}`, mapRow(row)]));
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

export function listServiceTypes({ activeOnly = false, environment = null } = {}) {
  return [...serviceTypes.values()].filter(
    (type) => (!activeOnly || type.isActive) && (!environment || type.environment === environment)
  );
}

/** Labels only: safe to send to any signed-in user. */
export function listServiceTypesPublic({ environment = null } = {}) {
  return listServiceTypes({ environment }).map(({ key, label, shortLabel, isActive, environment }) => ({
    key,
    label,
    shortLabel,
    isActive,
    environment,
  }));
}

export function getServiceTypeLabel(serviceTag, environment = null) {
  return findType(serviceTag, environment)?.label || serviceTag;
}

/** The type must exist and be active. Returns the key. */
export function assertServiceTag(serviceTag, environment = null) {
  const type = findType(serviceTag, environment);
  if (!type || !type.isActive) {
    throw new AppError('Invalid or inactive customer type', 400, 'VALIDATION_ERROR');
  }
  return serviceTag;
}

/** CRM settings for a type: tag, device product and price segment. */
export function getServiceTagConfig(serviceTag, environment = null) {
  const type = findType(serviceTag, environment);
  if (!type) {
    throw new AppError('Invalid service tag', 400, 'VALIDATION_ERROR');
  }

  // The .env ids are live ids: a sandbox type must carry its own.
  const fallback = (type.environment === 'live' && BUILT_IN_FALLBACKS[serviceTag]?.()) || {};
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

/** Every package must belong to the operator's CRM environment and one of its customer types. */
export function assertPackagesMatchServiceTypes(plans = [], allowedKeys = [], environment = 'live') {
  const allowed = new Set(allowedKeys);
  for (const plan of plans) {
    const tag = plan.serviceTag || plan.service_tag || 'OTT';
    const planEnvironment = plan.environment || 'live';
    if (planEnvironment !== environment) {
      throw new AppError(
        `Package "${plan.name}" is a ${planEnvironment} package and cannot be given to a ${environment} operator`,
        400,
        'CRM_ENVIRONMENT_MISMATCH'
      );
    }
    if (!allowed.has(tag)) {
      throw new AppError(
        `Package "${plan.name}" is for ${getServiceTypeLabel(tag, environment)} customers, which this operator is not allowed to serve`,
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
