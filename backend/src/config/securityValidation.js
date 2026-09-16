import { config, isProduction } from './index.js';

const DEFAULT_SEED_PASSWORD = 'ChangeMe@Secure123';
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Fail fast on unsafe production configuration before the server accepts traffic.
 */
export function validateSecurityConfig() {
  const errors = [];

  if (config.jwt.accessSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(`JWT_ACCESS_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }
  if (config.jwt.refreshSecret.length < MIN_JWT_SECRET_LENGTH) {
    errors.push(`JWT_REFRESH_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }

  if (isProduction) {
    if (config.wallet.autoCompleteTopup) {
      errors.push('WALLET_AUTO_COMPLETE_TOPUP must be false when NODE_ENV=production');
    }

    if (config.bml.enabled) {
      if (!config.bml.authToken && !config.bml.apiKey) {
        errors.push('BML_AUTH_TOKEN or BML_API_KEY is required when BML_ENABLED=true in production');
      }
      if (!config.bml.apiKey) {
        errors.push('BML_API_KEY is required in production for webhook signature verification');
      }
      if (!config.bml.redirectUrl?.startsWith('https://')) {
        errors.push('BML_REDIRECT_URL must use HTTPS in production');
      }
    }

    if (!config.corsOrigin.startsWith('https://')) {
      errors.push('CORS_ORIGIN must use HTTPS in production');
    }

    const seedPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!seedPassword || seedPassword === DEFAULT_SEED_PASSWORD) {
      errors.push('Set a strong SEED_ADMIN_PASSWORD in production (not the default)');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Security configuration failed:\n- ${errors.join('\n- ')}`);
  }
}
