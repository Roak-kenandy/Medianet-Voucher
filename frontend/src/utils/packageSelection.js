export function togglePackageId(currentIds, packageId) {
  const id = Number(packageId);
  const current = currentIds.map(Number);
  return current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id];
}

export function resolveActivePackageIds(packageIds, taggedPackages) {
  if (packageIds.length) return packageIds;
  if (taggedPackages.length === 1) return [taggedPackages[0].id];
  return [];
}
