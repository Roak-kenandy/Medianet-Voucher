import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

export const SERVICE_TAG_KEYS = ['OTT', 'MEDIANET_TV'];

export const SERVICE_SCOPE_KEYS = ['OTT', 'MEDIANET_TV', 'BOTH'];

export const SERVICE_SCOPES = {
  OTT: { key: 'OTT', label: 'Mobile only' },
  MEDIANET_TV: { key: 'MEDIANET_TV', label: 'TV only' },
  BOTH: { key: 'BOTH', label: 'Mobile & TV' },
};

export const SERVICE_TAGS = {
  OTT: {
    key: 'OTT',
    label: 'Mobile (OTT)',
    crmTagName: 'OTT',
    // CRM price tiers are segmented (e.g. OTT vs Dhiraagu OTT).
    crmPriceSegmentName: 'OTT',
  },
  MEDIANET_TV: {
    key: 'MEDIANET_TV',
    label: 'TV (Medianet TV)',
    crmTagName: 'Medianet TV',
    // TV products are tagged separately; price tiers are not filtered by segment name.
    crmPriceSegmentName: null,
  },
};

export function assertServiceScope(serviceScope) {
  if (!SERVICE_SCOPE_KEYS.includes(serviceScope)) {
    throw new AppError('Invalid service scope. Use OTT, MEDIANET_TV, or BOTH.', 400, 'VALIDATION_ERROR');
  }
  return serviceScope;
}

export function getAllowedServiceTags(serviceScope = 'BOTH') {
  const scope = assertServiceScope(serviceScope || 'BOTH');
  if (scope === 'BOTH') {
    return [...SERVICE_TAG_KEYS];
  }
  return [scope];
}

export function assertPackagesMatchServiceScope(plans = [], serviceScope = 'BOTH') {
  const allowed = new Set(getAllowedServiceTags(serviceScope));
  for (const plan of plans) {
    const tag = plan.serviceTag || plan.service_tag || 'OTT';
    if (!allowed.has(tag)) {
      throw new AppError(
        `Package "${plan.name}" is not allowed for ${SERVICE_SCOPES[serviceScope]?.label || serviceScope} operators`,
        400,
        'PACKAGE_SCOPE_MISMATCH'
      );
    }
  }
}

export function getServiceTagConfig(serviceTag) {
  const tag = SERVICE_TAGS[serviceTag];
  if (!tag) {
    throw new AppError('Invalid service tag', 400, 'VALIDATION_ERROR');
  }

  const crmTagId =
    serviceTag === 'OTT' ? config.crm.defaultTagId : config.crm.medianetTvTagId;

  const crmDeviceProductId =
    serviceTag === 'OTT' ? config.crm.deviceProductId : config.crm.medianetTvDeviceProductId;

  if (!crmTagId) {
    throw new AppError(
      `Service tag is not configured for ${tag.label}`,
      503,
      'CRM_NOT_CONFIGURED'
    );
  }

  if (!crmDeviceProductId) {
    throw new AppError(
      `Device type is not configured for ${tag.label}`,
      503,
      'CRM_NOT_CONFIGURED'
    );
  }

  return {
    ...tag,
    crmTagId,
    crmDeviceProductId,
  };
}

export function assertServiceTag(serviceTag) {
  if (!SERVICE_TAG_KEYS.includes(serviceTag)) {
    throw new AppError('Invalid service tag. Use OTT or MEDIANET_TV.', 400, 'VALIDATION_ERROR');
  }
  return serviceTag;
}
