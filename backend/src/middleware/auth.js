import {
  login,
  refreshSession,
  logout,
  verifyAccessToken,
  setRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE,
  findUserById,
} from '../services/authService.js';
import { sanitizeUser } from '../utils/crypto.js';
import { AppError } from '../utils/errors.js';

export function authenticate(req, _res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      role: payload.role,
      email: payload.email,
      clientName: payload.clientName,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError('Access denied', 403, 'FORBIDDEN'));
    }
    next();
  };
}

export const authController = {
  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const result = await login({ email, password }, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      setRefreshCookie(res, result.refreshToken);

      return res.json({
        success: true,
        data: {
          accessToken: result.accessToken,
          user: result.user,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async refresh(req, res, next) {
    try {
      const refreshToken = req.cookies[REFRESH_COOKIE];
      const result = await refreshSession(refreshToken);
      setRefreshCookie(res, result.refreshToken);

      return res.json({
        success: true,
        data: {
          accessToken: result.accessToken,
          user: result.user,
        },
      });
    } catch (err) {
      clearRefreshCookie(res);
      next(err);
    }
  },

  async logout(req, res, next) {
    try {
      const refreshToken = req.cookies[REFRESH_COOKIE];
      await logout(refreshToken, req.user || {});
      clearRefreshCookie(res);
      return res.json({ success: true, data: { message: 'Logged out successfully' } });
    } catch (err) {
      next(err);
    }
  },

  async me(req, res, next) {
    try {
      const user = await findUserById(req.user.role, req.user.id);
      if (!user || !user.is_active) {
        throw new AppError('User not found', 401, 'UNAUTHORIZED');
      }
      return res.json({
        success: true,
        data: { user: sanitizeUser(user, req.user.role) },
      });
    } catch (err) {
      next(err);
    }
  },
};
