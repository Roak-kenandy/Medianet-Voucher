/*
 * Global settings (time zone, currency, GST rate, TIN) arrive from the API with the signed-in
 * user and are kept here so date helpers can be used anywhere.
 */
let settings = {
  timeZone: 'Indian/Maldives',
  currencyCode: 'MVR',
  gstRatePercent: 0,
  tinNumber: '',
};

export function setAppSettings(next) {
  if (next && typeof next === 'object') {
    settings = { ...settings, ...next };
  }
}

export function getAppSettings() {
  return settings;
}

function format(value, options) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: settings.timeZone }).format(date);
  } catch {
    // Unknown time zone in this browser: fall back to the browser's own zone.
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

/** Date and time in the portal's configured time zone. */
export function formatDateTime(value) {
  return format(value, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Date only, in the portal's configured time zone. */
export function formatDate(value) {
  return format(value, { dateStyle: 'medium' });
}
