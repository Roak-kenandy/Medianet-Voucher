import { config } from '../config/index.js';
import { query, getConnection } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { logAudit } from './auditService.js';

/*
 * Global settings live in `app_settings` and are read through a short-lived in-memory copy.
 * GST rate and currency are also written onto `config.wallet`, which every wallet calculation
 * already reads at call time, so a change applies to new top-ups without a restart.
 */
const CACHE_TTL_MS = 15 * 1000;

/** Currencies the portal can run in. Wallet, BML and CRM amounts are all in this currency. */
export const SUPPORTED_CURRENCIES = ['MVR'];

// Captured before any override so "not set" can always fall back to the .env values.
const ENV_DEFAULTS = {
  timeZone: 'Indian/Maldives',
  gstRatePercent: Math.round(config.wallet.gstRate * 10000) / 100,
  tinNumber: '',
  currencyCode: SUPPORTED_CURRENCIES.includes(config.wallet.currencyCode) ? config.wallet.currencyCode : 'MVR',
};

let settings = { ...ENV_DEFAULTS };
let loadedAt = 0;
let loading = null;

export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function fromRows(rows) {
  const stored = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
  const gst = Number(stored.gstRatePercent);
  return {
    timeZone: stored.timeZone && isValidTimeZone(stored.timeZone) ? stored.timeZone : ENV_DEFAULTS.timeZone,
    gstRatePercent:
      stored.gstRatePercent != null && Number.isFinite(gst) && gst >= 0 && gst <= 100
        ? gst
        : ENV_DEFAULTS.gstRatePercent,
    tinNumber: stored.tinNumber ?? ENV_DEFAULTS.tinNumber,
    currencyCode: SUPPORTED_CURRENCIES.includes(stored.currencyCode) ? stored.currencyCode : ENV_DEFAULTS.currencyCode,
  };
}

function applyToConfig() {
  config.wallet.gstRate = Math.round(settings.gstRatePercent * 100) / 10000;
  config.wallet.currencyCode = settings.currencyCode;
}

export async function reloadAppSettings() {
  const rows = await query('SELECT setting_key, setting_value FROM app_settings');
  settings = fromRows(rows);
  loadedAt = Date.now();
  applyToConfig();
}

export async function ensureAppSettingsLoaded() {
  if (Date.now() - loadedAt < CACHE_TTL_MS) return;
  if (!loading) {
    loading = reloadAppSettings().finally(() => {
      loading = null;
    });
  }
  await loading;
}

/** Express middleware: keeps settings fresh for the request. */
export function refreshAppSettings(_req, _res, next) {
  ensureAppSettingsLoaded().then(() => next(), next);
}

export function getAppSettings() {
  return { ...settings };
}

/** What every signed-in user's browser needs to format dates, money and bills. */
export function getPublicAppSettings() {
  return { ...settings };
}

export async function getAppSettingsForStaff() {
  await reloadAppSettings();
  return { ...settings, supportedCurrencies: SUPPORTED_CURRENCIES, defaults: { ...ENV_DEFAULTS } };
}

export async function updateAppSettings(adminId, data, reqMeta = {}) {
  if (!isValidTimeZone(data.timeZone)) {
    throw new AppError('Unknown time zone', 400, 'VALIDATION_ERROR');
  }
  if (!SUPPORTED_CURRENCIES.includes(data.currencyCode)) {
    throw new AppError('Unsupported currency', 400, 'VALIDATION_ERROR');
  }

  await reloadAppSettings();
  const before = { ...settings };
  const next = {
    timeZone: data.timeZone,
    gstRatePercent: String(data.gstRatePercent),
    tinNumber: data.tinNumber.trim(),
    currencyCode: data.currencyCode,
  };

  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    for (const [key, value] of Object.entries(next)) {
      await connection.execute(
        `INSERT INTO app_settings (setting_key, setting_value, updated_by_admin_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by_admin_id = VALUES(updated_by_admin_id)`,
        [key, value, adminId]
      );
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  await reloadAppSettings();

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'APP_SETTINGS_UPDATED',
    resourceType: 'app_settings',
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { before, after: { ...settings } },
  });

  return getAppSettingsForStaff();
}
