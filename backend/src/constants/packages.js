export const PACKAGE_CATALOG = [
  {
    value: 'OTT ENTERTAINMENT (1y)',
    label: 'OTT ENTERTAINMENT (1y)',
    productId: '4bda88eb-05f0-4ac5-b68e-415c0c784b56',
    priceTermId: '605e6004-505e-4aa2-ab1e-e57bf9c79b14',
    priceAmount: 599,
  },
];

export const PACKAGE_TYPES = PACKAGE_CATALOG.map(({ value, label }) => ({ value, label }));

export const PACKAGE_VALUES = PACKAGE_TYPES.map((p) => p.value);

export const DEFAULT_PACKAGE = PACKAGE_VALUES[0] || 'OTT ENTERTAINMENT (1y)';

export function isValidPackage(value) {
  return PACKAGE_VALUES.includes(value);
}

export function getPlanByPackageType(packageType) {
  const pkg = PACKAGE_CATALOG.find((entry) => entry.value === packageType);

  if (!pkg?.productId || !pkg?.priceTermId) {
    return null;
  }

  return {
    id: pkg.value.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    product_id: pkg.productId,
    price_term_id: pkg.priceTermId,
    priceAmount: pkg.priceAmount,
  };
}
