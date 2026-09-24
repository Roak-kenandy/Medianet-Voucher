import { config, isProduction } from './index.js';

const MIN_JWT_SECRET_LENGTH = 32;
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 64;

const KNOWN_WEAK_JWT_SECRETS = new Set([
  'change-this-to-a-long-random-string-min-32-chars',
  'change-this-to-another-long-random-string-min-32-chars',
]);

function isWeakJwtSecret(value) {
  if (!value) return true;
  if (KNOWN_WEAK_JWT_SECRETS.has(value)) return true;
  if (/change-this/i.test(value)) return true;
  return false;
}

/**
 * Fail fast on unsafe production configuration before the server accepts traffic.
 * Only checks that block safe operation — not seed-script or optional webhook settings.
 */
export function validateSecurityConfig() {
  const errors = [];
  const warnings = [];

  const minLen = isProduction ? MIN_PRODUCTION_JWT_SECRET_LENGTH : MIN_JWT_SECRET_LENGTH;

  if (config.jwt.accessSecret.length < minLen) {
    errors.push(`JWT_ACCESS_SECRET must be at least ${minLen} characters`);
  }
  if (config.jwt.refreshSecret.length < minLen) {
    errors.push(`JWT_REFRESH_SECRET must be at least ${minLen} characters`);
  }

  if (isWeakJwtSecret(config.jwt.accessSecret)) {
    errors.push('JWT_ACCESS_SECRET must not use the .env.example placeholder or a known weak value');
  }
  if (isWeakJwtSecret(config.jwt.refreshSecret)) {
    errors.push('JWT_REFRESH_SECRET must not use the .env.example placeholder or a known weak value');
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

    if (config.seed.adminPassword === 'ChangeMe@Secure123') {
      errors.push(
        'SEED_ADMIN_PASSWORD must not use the default placeholder in production (rotate even if you do not run npm run seed)'
      );
    }

    if (config.crm.apiKey && /example|placeholder|changeme/i.test(config.crm.apiKey)) {
      warnings.push(
        'CRM_API_KEY looks like a placeholder — rotate the key in CRM and update production .env (git history may still contain old keys)'
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
