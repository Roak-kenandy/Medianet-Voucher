export function formatMoney(amount, currencyCode = 'MVR') {
  const value = Number(amount);
  if (Number.isNaN(value)) return '—';
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyCode}`;
}

export function sumPackagePrices(packages = [], selectedIds = []) {
  const ids = selectedIds.map(Number);
  return packages
    .filter((pkg) => ids.includes(Number(pkg.id)))
    .reduce((sum, pkg) => sum + Number(pkg.priceAmount || 0), 0);
}
