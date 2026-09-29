import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
export const isProduction = nodeEnv === 'production';
export const isDevelopment = nodeEnv === 'development';

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function boundedInt(raw, fallback, min, max) {
  const parsed = parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Express `trust proxy` value: hop count, `false`, or a named/CIDR list (default: local nginx only). */
function parseTrustProxy(raw) {
  if (raw == null || raw === '') return 'loopback';
  const value = String(raw).trim();
  if (value === 'false') return false;
  if (value === 'true') {
    throw new Error('TRUST_PROXY=true trusts any client-supplied X-Forwarded-For; use a hop count or proxy IP list');
  }
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value;
}

export const config = {
  env: nodeEnv,
  port: parseInt(process.env.PORT || '4000', 10),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: requireEnv('DB_NAME'),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    connectionLimit: boundedInt(process.env.DB_POOL_SIZE, 10, 2, 100),
    queueLimit: boundedInt(process.env.DB_POOL_QUEUE_LIMIT, 200, 10, 10000),
  },
  jwt: {
    accessSecret: requireEnv('JWT_ACCESS_SECRET'),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  security: {
    bcryptRounds: 12,
    maxLoginAttempts: 5,
    lockoutMinutes: 15,
    bulkUploadMax: 10,
  },
  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@medianet.mv',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe@Secure123',
    adminName: process.env.SEED_ADMIN_NAME || 'System Admin',
  },
  crm: {
    apiKey: process.env.CRM_API_KEY || '',
    baseUrl: process.env.CRM_BASE_URL || '',
    defaultTagId: process.env.DEFAULT_TAG_ID || '',
    medianetTvTagId:
      process.env.MEDIANET_TV_TAG_ID || '9f780709-6758-4394-9241-1b975cb7d4a1',
    deviceProductId: process.env.DEVICE_PRODUCT_ID || '',
    medianetTvDeviceProductId:
      process.env.MEDIANET_TV_DEVICE_PRODUCT_ID || '84fa34b8-d2ba-423f-844b-559367cc4f43',
    classificationId: process.env.CLASSIFICATION_ID || '',
    currencyCode: process.env.CURRENCY_CODE || 'MVR',
    paymentTermsId: process.env.PAYMENT_TERMS_ID || '',
    paymentTypeId: process.env.PAYMENT_TYPE_ID || '199f072f-977d-4056-8262-d7e467bbccbb7',
    salesModelName: process.env.CRM_SALES_MODEL_NAME || 'Retail',
    requestTimeoutMs: boundedInt(process.env.CRM_REQUEST_TIMEOUT_MS, 60000, 1000, 120000),
    maxConcurrentPerOperator: boundedInt(process.env.CRM_MAX_CONCURRENT_PER_OPERATOR, 2, 1, 10),
    maxConcurrentGlobal: boundedInt(process.env.CRM_MAX_CONCURRENT_GLOBAL, 8, 1, 50),
  },
  wallet: {
    currencyCode: process.env.WALLET_CURRENCY_CODE || process.env.CURRENCY_CODE || 'MVR',
    commissionRate: Math.max(0, Math.min(1, parseFloat(process.env.WALLET_COMMISSION_RATE || '0'))),
    gstRate: Math.max(0, Math.min(1, parseFloat(process.env.WALLET_GST_RATE || '0.08'))),
    minTopupAmount: parseFloat(process.env.WALLET_MIN_TOPUP || '100'),
    maxTopupAmount: parseFloat(process.env.WALLET_MAX_TOPUP || '1000000'),
    // Dev-only instant credit without BML. Never enabled in production.
    autoCompleteTopup:
      !isProduction &&
      process.env.BML_ENABLED !== 'true' &&
      process.env.WALLET_AUTO_COMPLETE_TOPUP === 'true',
    allowManualTopupComplete:
      !isProduction && process.env.ALLOW_MANUAL_TOPUP_COMPLETE === 'true',
  },
  bml: {
    enabled: process.env.BML_ENABLED === 'true',
    apiBaseUrl:
      process.env.BML_API_BASE_URL || 'https://api.merchants.bankofmaldives.com.mv',
    apiMode: process.env.BML_API_MODE || 'v1',
    authToken: process.env.BML_AUTH_TOKEN || '',
    apiKey: process.env.BML_API_KEY || '',
    appId: process.env.BML_APP_ID || '',
    sendAppIdHeader: process.env.BML_SEND_APP_ID_HEADER === 'true',
    deviceId: process.env.BML_DEVICE_ID || 'medianet-voucher',
    appVersion: process.env.BML_APP_VERSION || 'medianet-voucher/1.0',
    signMethod: process.env.BML_SIGN_METHOD || 'sha1',
    provider: process.env.BML_PROVIDER || '',
    locale: process.env.BML_LOCALE || 'en',
    redirectUrl: process.env.BML_REDIRECT_URL || '',
    webhookUrl: process.env.BML_WEBHOOK_URL || '',
    requestTimeoutMs: boundedInt(process.env.BML_REQUEST_TIMEOUT_MS, 30000, 1000, 120000),
  },
};
