import dotenv from 'dotenv';

dotenv.config();

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: requireEnv('DB_NAME'),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
  },
  jwt: {
    accessSecret: requireEnv('JWT_ACCESS_SECRET'),
    refreshSecret: requireEnv('JWT_REFRESH_SECRET'),
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
    deviceProductId: process.env.DEVICE_PRODUCT_ID || '',
    classificationId: process.env.CLASSIFICATION_ID || '',
    currencyCode: process.env.CURRENCY_CODE || 'MVR',
    paymentTermsId: process.env.PAYMENT_TERMS_ID || '',
    paymentTypeId: process.env.PAYMENT_TYPE_ID || 'a3afdee8-3596-4e3a-8df4-1ddc99f86107',
  },
};

export const isProduction = config.env === 'production';
