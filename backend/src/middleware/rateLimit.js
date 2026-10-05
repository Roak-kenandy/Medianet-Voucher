import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

/**
 * Relies on `trust proxy` (TRUST_PROXY) so req.ip is the real client behind nginx.
 * IPv6 clients are keyed on their /64 network: one subscriber controls a whole /64, so
 * keying on the full address would hand out a fresh budget per address.
 */
export function clientIpKey(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  if (!ip.includes(':')) return ip;
  return `${ipv6Prefix64(ip)}::/64`;
}

function ipv6Prefix64(address) {
  const [head, tail = ''] = address.split('%')[0].toLowerCase().split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = Math.max(0, 8 - headGroups.length - tailGroups.length);
  const groups = address.includes('::')
    ? [...headGroups, ...Array(missing).fill('0'), ...tailGroups]
    : headGroups;
  return groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':');
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
 * from elsewhere. This is the hard block after repeated wrong passwords from one client;
 * the account-wide DB lock is only a much higher ceiling against distributed guessing.
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
  windowMs: config.security.lockoutMinutes * 60 * 1000,
  max: config.security.maxLoginAttempts,
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

/** Operator dashboard / history reads: plain list queries, but they share the DB pool. */
export const operatorReadLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: portalRateLimitKey,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many requests. Please wait a moment.',
  },
});

export const staffDashboardLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: portalRateLimitKey,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many dashboard refreshes. Please wait a moment.',
  },
});

export const passwordChangeLimiter = rateLimit({
  ...rateLimitDefaults,
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: portalRateLimitKey,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many password change attempts. Please try again later.',
  },
});

/**
 * Caps how many requests one signed-in user may have in flight on the routes it guards.
 * A rate limit alone does not stop a burst of slow queries from occupying the shared
 * database pool; this does. Counters are per process.
 */
export function limitConcurrentPerUser(max, scope) {
  const inFlight = new Map();
  return (req, res, next) => {
    const key = `${scope}:${req.user?.role || 'anon'}:${req.user?.id ?? clientIpKey(req)}`;
    const active = inFlight.get(key) || 0;
    if (active >= max) {
      return res.status(429).json({
        success: false,
        code: 'TOO_MANY_CONCURRENT_REQUESTS',
        message: 'Earlier requests are still loading. Please wait for them to finish.',
      });
    }
    inFlight.set(key, active + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const remaining = (inFlight.get(key) || 1) - 1;
      if (remaining <= 0) inFlight.delete(key);
      else inFlight.set(key, remaining);
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}
