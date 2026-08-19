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
import { isStaffRole, hasPermission, STAFF_ROLES } from '../constants/permissions.js';

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

export function requireStaffRole() {
  return (req, _res, next) => {
    if (!req.user || !isStaffRole(req.user.role)) {
      return next(new AppError('Access denied', 403, 'FORBIDDEN'));
    }
    next();
  };
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user || !hasPermission(req.user.role, permission)) {
      return next(new AppError('Access denied', 403, 'FORBIDDEN'));
    }
    next();
  };
}

export { STAFF_ROLES, isStaffRole, hasPermission };

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
      const lookupRole = req.user.role === 'operator' ? 'operator' : 'admin';
      const user = await findUserById(lookupRole, req.user.id);
      if (!user || !user.is_active) {
        throw new AppError('User not found', 401, 'UNAUTHORIZED');
      }
      const role =
        req.user.role === 'operator' ? 'operator' : user.role || 'admin';
      return res.json({
        success: true,
        data: { user: sanitizeUser(user, role) },
      });
    } catch (err) {
      next(err);
    }
  },
};
