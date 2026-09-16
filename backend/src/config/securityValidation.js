import { config, isProduction } from './index.js';

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Fail fast on unsafe production configuration before the server accepts traffic.
 * Only checks that block safe operation — not seed-script or optional webhook settings.
 */
export function validateSecurityConfig() {
  const errors = [];
  const warnings = [];

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
      if (!config.bml.redirectUrl?.startsWith('https://')) {
        errors.push('BML_REDIRECT_URL must use HTTPS in production (e.g. https://your-domain/operator/wallet/payment/return)');
      }
      if (config.bml.webhookUrl && !config.bml.apiKey) {
        errors.push('BML_API_KEY is required when BML_WEBHOOK_URL is set (webhook signature verification)');
      } else if (config.bml.enabled && !config.bml.apiKey) {
        warnings.push('BML_API_KEY is not set — payment polling works; webhooks will not verify until configured');
      }
    }

    if (!config.corsOrigin.startsWith('https://')) {
      errors.push(
        `CORS_ORIGIN must use HTTPS in production (current: ${config.corsOrigin}). Example: https://your-frontend-domain.com`
      );
    }
  }

  for (const message of warnings) {
    console.warn(`[Security] Warning: ${message}`);
  }

  if (errors.length > 0) {
    throw new Error(`Security configuration failed:\n- ${errors.join('\n- ')}`);
  }
}
