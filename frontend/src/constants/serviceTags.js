export const SERVICE_TAGS = [
  { key: 'OTT', label: 'Mobile (OTT)', crmTagName: 'OTT' },
  { key: 'MEDIANET_TV', label: 'TV (Medianet TV)', crmTagName: 'Medianet TV' },
];

export const SERVICE_SCOPES = [
  { key: 'OTT', label: 'Mobile only' },
  { key: 'MEDIANET_TV', label: 'TV only' },
  { key: 'BOTH', label: 'Mobile & TV' },
];

export function getServiceTagLabel(key) {
  return SERVICE_TAGS.find((tag) => tag.key === key)?.label || key;
}

export function getServiceScopeLabel(key) {
  return SERVICE_SCOPES.find((scope) => scope.key === key)?.label || key;
}

export function getAllowedServiceTags(serviceScope = 'BOTH') {
  if (serviceScope === 'BOTH' || !serviceScope) {
    return SERVICE_TAGS.map((tag) => tag.key);
  }
  return [serviceScope];
}

export function filterServiceTags(serviceScope = 'BOTH') {
  const allowed = getAllowedServiceTags(serviceScope);
  return SERVICE_TAGS.filter((tag) => allowed.includes(tag.key));
}

export function packageMatchesScope(pkg, serviceScope = 'BOTH') {
  const tag = pkg.serviceTag || pkg.service_tag || 'OTT';
  if (serviceScope === 'BOTH' || !serviceScope) {
    return true;
  }
  return tag === serviceScope;
}

export function defaultServiceTag(serviceScope = 'BOTH') {
  return getAllowedServiceTags(serviceScope)[0] || 'OTT';
}
