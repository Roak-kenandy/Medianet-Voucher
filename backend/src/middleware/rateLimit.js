import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many requests. Please try again later.',
  },
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
});

export const createAccountLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'RATE_LIMIT',
    message: 'Too many account creation requests. Please slow down.',
  },
});
