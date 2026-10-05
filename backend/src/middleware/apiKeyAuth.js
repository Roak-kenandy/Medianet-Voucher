import rateLimit from 'express-rate-limit';
import { query } from '../db/pool.js';
import { hashToken } from '../utils/crypto.js';
import { clientIpKey } from './rateLimit.js';

const KEY_PATTERN = /^mtvop_[0-9a-f]{8}_[A-Za-z0-9_-]{20,80}$/;
const LAST_USED_REFRESH_MS = 60 * 1000;
const lastUsedWrites = new Map();

function unauthorized(res) {
  // One answer for every failure, so a caller cannot tell a revoked key from a wrong one.
  return res.status(401).json({
    success: false,
    code: 'UNAUTHORIZED',
    message: 'Missing or invalid API key',
  });
}

function readApiKey(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const direct = req.headers['x-api-key'];
  return typeof direct === 'string' ? direct.trim() : '';
}

/**
 * Partner API authentication. The key identifies one operator; everything the request may do
 * is limited to that operator's customer types, sales models and packages, exactly as in the
 * portal. Keys are stored hashed, so the lookup is by hash.
 */
export async function authenticateApiKey(req, res, next) {
  try {
    const key = readApiKey(req);
    if (!KEY_PATTERN.test(key)) return unauthorized(res);

    const rows = await query(
      `SELECT k.id, k.name, k.key_prefix, k.operator_id, o.client_name, o.is_active, o.api_access_enabled
       FROM operator_api_keys k
       JOIN operators o ON o.id = k.operator_id
       WHERE k.key_hash = ? AND k.revoked_at IS NULL
       LIMIT 1`,
      [hashToken(key)]
    );
    const row = rows[0];
    if (!row) return unauthorized(res);
    if (!row.is_active) {
      return res.status(403).json({
        success: false,
        code: 'OPERATOR_INACTIVE',
        message: 'This operator account is inactive',
      });
    }

    if (!row.api_access_enabled) {
      return res.status(403).json({
        success: false,
        code: 'API_ACCESS_DISABLED',
        message: 'API access is turned off for this operator. Contact Medianet.',
      });
    }

    req.apiClient = {
      operatorId: row.operator_id,
      operatorName: row.client_name,
      apiKeyId: row.id,
      apiKeyName: row.name,
      keyPrefix: row.key_prefix,
    };
    // Shared helpers (rate limit keys, concurrency caps) read the operator from req.user.
    req.user = { id: row.operator_id, role: 'operator', apiKeyId: row.id };

    const now = Date.now();
    if (now - (lastUsedWrites.get(row.id) || 0) > LAST_USED_REFRESH_MS) {
      lastUsedWrites.set(row.id, now);
      query('UPDATE operator_api_keys SET last_used_at = NOW() WHERE id = ?', [row.id]).catch(() => {});
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

const limiterDefaults = { standardHeaders: true, legacyHeaders: false };
const tooMany = (message) => ({ success: false, code: 'RATE_LIMIT', message });
const apiKeyBucket = (scope) => (req) => `api:${scope}:${req.apiClient?.apiKeyId ?? clientIpKey(req)}`;

/** Counts only rejected keys, per network: stops key guessing without touching valid callers. */
export const apiAuthFailureLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  keyGenerator: (req) => `api-auth:${clientIpKey(req)}`,
  message: tooMany('Too many requests with an invalid API key. Try again in 15 minutes.'),
});

/** Local reads (packages, wallet, transactions). */
export const apiReadLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: apiKeyBucket('read'),
  message: tooMany('Too many requests. Slow down and retry shortly.'),
});

/** Customer lookups: each one is several CRM calls. */
export const apiCustomerLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: apiKeyBucket('customer'),
  message: tooMany('Too many customer lookups. Slow down and retry shortly.'),
});

/** Top-ups and purchases. */
export const apiWriteLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: apiKeyBucket('write'),
  message: tooMany('Too many transactions. Slow down and retry shortly.'),
});
