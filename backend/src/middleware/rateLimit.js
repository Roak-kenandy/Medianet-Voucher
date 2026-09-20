import rateLimit from 'express-rate-limit';

function clientIpKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

const rateLimitDefaults = {
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIpKey,
};

function isAuthenticatedPortalRequest(req) {
  return Boolean(req.headers.authorization?.startsWith('Bearer '));
}

export const globalLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 1000,
  // Staff/operator sessions share one nginx IP in production — do not throttle
  // normal logged-in portal usage with the anonymous API bucket.
  skip: isAuthenticatedPortalRequest,
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
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many webhook requests.',
  },
});
