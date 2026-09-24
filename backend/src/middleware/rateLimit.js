import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

function clientIpKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
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

export const loginLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = req.body?.email?.toLowerCase?.()?.trim();
    return email ? `login:${email}` : `ip:${clientIpKey(req)}`;
  },
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
});

export const refreshLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 120,
  skipSuccessfulRequests: true,
  keyGenerator: portalRateLimitKey,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many session refresh attempts. Please try again shortly.',
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
