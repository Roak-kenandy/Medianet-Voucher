import { getAppSettings } from '../constants/appSettings';

const DEFAULT_GST_RATE = 0.08;

function currentGstRate() {
  const percent = Number(getAppSettings().gstRatePercent);
  return Number.isFinite(percent) && percent > 0 ? percent / 100 : DEFAULT_GST_RATE;
}

/** Finance revenue-share ratio: (100 + GST%) / (100 + GST% - share). 50% at 8% GST is 108 / 58. */
export function revenueShareRatio(sharePercent, gstRate = currentGstRate()) {
  const share = Number(sharePercent) || 0;
  const total = 100 * (1 + Math.max(0, Math.min(1, Number(gstRate) || 0)));
  if (share <= 0 || share >= total) return 1;
  return total / (total - share);
}

export function commissionRatio(type, value, gstRate) {
  const num = Number(value) || 0;
  if (type === 'multiplier') return num > 1 ? num : 1;
  if (type === 'percent') return revenueShareRatio(num, gstRate);
  return 1;
}

/** Ratio as finance writes it: up to 14 decimal places (1.86206896551724). */
export function formatRatio(ratio) {
  return String(Number(Number(ratio).toFixed(14)));
}
