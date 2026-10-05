/*
 * Customer (service) types are configured by staff and arrive from the API with the signed-in
 * user. They are kept in this module so label helpers can be used anywhere. A "scope" is the
 * list of type keys an operator may serve; the old 'BOTH' value means every type.
 */
const BUILT_IN = [
  { key: 'OTT', label: 'Mobile (OTT)', shortLabel: 'Mobile', isActive: true },
  { key: 'MEDIANET_TV', label: 'TV (Medianet TV)', shortLabel: 'TV', isActive: true },
];

let serviceTypes = BUILT_IN;

export function setServiceTypes(list) {
  if (Array.isArray(list) && list.length) {
    serviceTypes = list.map((type) => ({ ...type, isActive: type.isActive !== false }));
  }
}

/** Every configured type, including inactive ones (needed to label old records). */
export function getServiceTypes({ activeOnly = false } = {}) {
  return activeOnly ? serviceTypes.filter((type) => type.isActive) : serviceTypes;
}

export function getServiceTagLabel(key) {
  return serviceTypes.find((type) => type.key === key)?.label || key;
}

export function getServiceTagShortLabel(key) {
  return serviceTypes.find((type) => type.key === key)?.shortLabel || key;
}

/** Normalises a scope (array of keys, a single key, or legacy 'BOTH') to an array of keys. */
export function getAllowedServiceTags(serviceScope = 'BOTH') {
  if (Array.isArray(serviceScope)) return serviceScope;
  if (!serviceScope || serviceScope === 'BOTH') {
    return getServiceTypes({ activeOnly: true }).map((type) => type.key);
  }
  return [serviceScope];
}

export function getServiceScopeLabel(serviceScope = 'BOTH') {
  const keys = getAllowedServiceTags(serviceScope);
  if (!keys.length) return 'No customer types';
  return keys.map(getServiceTagShortLabel).join(' & ');
}

/** Types in the scope, in the scope's own order (an operator's default type comes first). */
export function filterServiceTags(serviceScope = 'BOTH') {
  return getAllowedServiceTags(serviceScope).map((key) => ({
    key,
    label: getServiceTagLabel(key),
    shortLabel: getServiceTagShortLabel(key),
  }));
}

export function packageMatchesScope(pkg, serviceScope = 'BOTH') {
  const tag = pkg.serviceTag || pkg.service_tag || 'OTT';
  return getAllowedServiceTags(serviceScope).includes(tag);
}

/** True when the package's sales model is on the allow-list (packages without one always pass). */
export function packageMatchesSalesModels(pkg, salesModelIds) {
  const id = pkg.salesModelId ?? pkg.sales_model_id;
  if (id == null || !Array.isArray(salesModelIds)) return true;
  return salesModelIds.map(Number).includes(Number(id));
}

export function defaultServiceTag(serviceScope = 'BOTH') {
  return getAllowedServiceTags(serviceScope)[0] || 'OTT';
}
