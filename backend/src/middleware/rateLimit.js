import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

/** Relies on `trust proxy` (TRUST_PROXY) so req.ip is the real client behind nginx. */
function clientIpKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

/**
 * Prefer authenticated subject over shared nginx IP; invalid tokens fall back to IP.
 */
function portalRateLimitKey(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), config.jwt.accessSecret, {
        algorithms: ['HS256'],
      });
      if (payload?.sub != null && payload?.role) {
        return `user:${payload.role}:${payload.sub}`;
      }
    } catch {
      // Treat as anonymous when the bearer token is invalid or expired.
    }
  }
  return `ip:${clientIpKey(req)}`;
}

const rateLimitDefaults = {
  standardHeaders: true,
  legacyHeaders: false,
};

export const globalLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyGenerator: portalRateLimitKey,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many requests. Please try again later.',
  },
});

/**
 * Per source: caps password spraying across many accounts from one client.
 * Per account + source: keyed on both so an attacker cannot rate-limit a victim's email
 * from elsewhere (the per-account DB lockout still applies globally).
 */
export const loginIpLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 60,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `login-ip:${clientIpKey(req)}`,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many login attempts from this network. Please try again in 15 minutes.',
  },
});

export const loginLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = req.body?.email?.toLowerCase?.()?.trim?.() || '';
    return `login:${shortHash(email)}:${clientIpKey(req)}`;
  },
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
});

/** Keyed on the refresh cookie itself so users behind one NAT / proxy do not share a bucket. */
export const refreshLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 120,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const cookie = req.cookies?.refresh_token;
    return cookie ? `refresh:${shortHash(cookie)}` : `refresh-ip:${clientIpKey(req)}`;
  },
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many session refresh attempts. Please try again shortly.',
  },
});

export const reportLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: portalRateLimitKey,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many report requests. Please wait a moment.',
  },
});

export const createAccountLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: portalRateLimitKey,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many account creation requests. Please slow down.',
  },
});

export const walletTopupLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: portalRateLimitKey,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many wallet top-up attempts. Please try again later.',
  },
});

export const walletStatusLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: portalRateLimitKey,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many payment status checks. Please wait a moment.',
  },
});

export const webhookLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: clientIpKey,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many webhook requests.',
  },
});

export const customerSearchLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 60 * 1000,
  max: 40,
  keyGenerator: portalRateLimitKey,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many customer lookups. Please wait a moment.',
  },
});
