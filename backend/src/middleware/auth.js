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
import {
  normalizePortalRole,
  parseOperatorPermissions,
  operatorHasPermission,
} from '../constants/operatorPermissions.js';
import { getClientMeta } from '../services/auditService.js';

function applyAccessTokenToRequest(req, token) {
  const payload = verifyAccessToken(token);
  req.user = {
    id: payload.sub,
    role: payload.role,
    email: payload.email,
    clientName: payload.clientName,
  };
}

export function authenticate(req, _res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.slice(7);

  try {
    applyAccessTokenToRequest(req, token);
    next();
  } catch (err) {
    next(err);
  }
}

/** Sets req.user when a valid access token is present; never fails the request. */
export function optionalAuthenticate(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }
  try {
    applyAccessTokenToRequest(req, authHeader.slice(7));
  } catch {
    // Ignore invalid tokens on logout.
  }
  next();
}

export function ensureActiveAccount(req, _res, next) {
  if (!req.user?.id || !req.user?.role) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  const lookupRole = req.user.role === 'operator' ? 'operator' : 'admin';

  findUserById(lookupRole, req.user.id)
    .then((user) => {
      if (!user || !user.is_active) {
        return next(new AppError('Account is inactive or not found', 401, 'UNAUTHORIZED'));
      }
      if (req.user.role === 'operator') {
        const portalRole = normalizePortalRole(user.portal_role);
        req.user.operatorPortalRole = portalRole;
        req.user.operatorPermissions = parseOperatorPermissions(
          portalRole,
          user.portal_permissions
        );
      } else if (isStaffRole(req.user.role)) {
        const dbRole = user.role || 'admin';
        if (!isStaffRole(dbRole)) {
          return next(new AppError('Access denied', 403, 'FORBIDDEN'));
        }
        req.user.role = dbRole;
      }
      next();
    })
    .catch(next);
}

export function requireOperatorPermission(permission) {
  return (req, _res, next) => {
    if (req.user?.role !== 'operator') {
      return next(new AppError('Access denied', 403, 'FORBIDDEN'));
    }
    if (
      !operatorHasPermission(
        req.user.operatorPortalRole,
        req.user.operatorPermissions,
        permission
      )
    ) {
      return next(new AppError('Access denied', 403, 'FORBIDDEN'));
    }
    next();
  };
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
      await logout(refreshToken, req.user || {}, getClientMeta(req));
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
