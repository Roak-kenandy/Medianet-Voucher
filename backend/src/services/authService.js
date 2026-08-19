import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { query, getConnection } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import {
  generateRefreshToken,
  hashToken,
  parseDurationToMs,
  sanitizeUser,
} from '../utils/crypto.js';
import { logAudit } from './auditService.js';
import { getOperatorPackages } from './packageService.js';

import { isStaffRole } from '../constants/permissions.js';

const REFRESH_COOKIE = 'refresh_token';

function getTableForRole(role) {
  if (role === 'operator') return 'operators';
  if (isStaffRole(role) || role === 'admin') return 'admins';
  return 'operators';
}

function getRefreshUserType(role) {
  return role === 'operator' ? 'operator' : 'admin';
}

function resolveStaffRole(user) {
  return user?.role || 'admin';
}

async function findStaffByEmail(email) {
  const rows = await query(
    `SELECT * FROM admins WHERE email = ? AND is_active = 1 LIMIT 1`,
    [email.toLowerCase().trim()]
  );
  return rows[0] || null;
}

export async function findUserById(role, id) {
  if (role === 'operator') {
    const rows = await query(
      `SELECT o.*
       FROM operators o
       WHERE o.id = ? LIMIT 1`,
      [id]
    );
    const user = rows[0];
    if (!user) return null;

    const packages = await getOperatorPackages(id);
    user.operator_packages = packages;
    user.package_name = packages.map((pkg) => pkg.name).join(', ') || user.package_type;
    return user;
  }

  const rows = await query(`SELECT * FROM admins WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

function isAccountLocked(user) {
  if (!user.locked_until) return false;
  return new Date(user.locked_until) > new Date();
}

async function recordFailedLogin(role, userId) {
  const table = getTableForRole(role);
  await query(
    `UPDATE ${table}
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= ? THEN DATE_ADD(NOW(), INTERVAL ? MINUTE)
           ELSE locked_until
         END
     WHERE id = ?`,
    [config.security.maxLoginAttempts, config.security.lockoutMinutes, userId]
  );
}

async function resetFailedLogin(role, userId) {
  const table = getTableForRole(role);
  await query(
    `UPDATE ${table} SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
    [userId]
  );
}

function signAccessToken(user, role) {
  const payload = {
    sub: user.id,
    role,
    email: user.email,
  };

  if (role === 'operator') {
    payload.clientName = user.client_name;
  }

  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
    algorithm: 'HS256',
  });
}

async function storeRefreshToken(role, userId, token) {
  const tokenHash = hashToken(token);
  const expiresMs = parseDurationToMs(config.jwt.refreshExpiresIn);
  const expiresAt = new Date(Date.now() + expiresMs);

  await query(
    `INSERT INTO refresh_tokens (user_type, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
    [role, userId, tokenHash, expiresAt]
  );
}

function setRefreshCookie(res, token) {
  const maxAge = parseDurationToMs(config.jwt.refreshExpiresIn);

  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'strict',
    maxAge,
    path: '/api/auth',
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: config.env === 'production',
    sameSite: 'strict',
    path: '/api/auth',
  });
}

async function resolveUserByEmail(email) {
  const normalizedEmail = email.toLowerCase().trim();

  const staffUser = await findStaffByEmail(normalizedEmail);
  if (staffUser) {
    return { user: staffUser, role: resolveStaffRole(staffUser) };
  }

  const rows = await query(
    `SELECT * FROM operators WHERE email = ? AND is_active = 1 LIMIT 1`,
    [normalizedEmail]
  );
  const operator = rows[0];
  if (operator) return { user: operator, role: 'operator' };

  return null;
}

export async function login({ email, password }, reqMeta = {}) {
  const resolved = await resolveUserByEmail(email);

  if (!resolved) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const { user: rawUser, role } = resolved;
  const user = role === 'operator' ? await findUserById('operator', rawUser.id) : rawUser;

  if (isAccountLocked(user)) {
    throw new AppError(
      'Account temporarily locked due to too many failed attempts. Try again later.',
      423,
      'ACCOUNT_LOCKED'
    );
  }

  const passwordValid = await bcrypt.compare(password, user.password_hash);

  if (!passwordValid) {
    await recordFailedLogin(role, user.id);
    await logAudit({
      actorType: role,
      actorId: user.id,
      action: 'LOGIN_FAILED',
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
    });
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  await resetFailedLogin(role, user.id);

  const accessToken = signAccessToken(user, role);
  const refreshToken = generateRefreshToken();
  await storeRefreshToken(getRefreshUserType(role), user.id, refreshToken);

  await logAudit({
    actorType: isStaffRole(role) ? 'admin' : role,
    actorId: user.id,
    action: 'LOGIN_SUCCESS',
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
  });

  return {
    accessToken,
    refreshToken,
    user: sanitizeUser(user, role),
  };
}

export async function refreshSession(refreshToken) {
  if (!refreshToken) {
    throw new AppError('Refresh token required', 401, 'UNAUTHORIZED');
  }

  const tokenHash = hashToken(refreshToken);
  const rows = await query(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  const stored = rows[0];
  if (!stored) {
    throw new AppError('Invalid or expired session', 401, 'UNAUTHORIZED');
  }

  const user = await findUserById(stored.user_type, stored.user_id);
  if (!user || !user.is_active) {
    throw new AppError('User account inactive', 401, 'UNAUTHORIZED');
  }

  const role =
    stored.user_type === 'operator' ? 'operator' : resolveStaffRole(user);

  // Rotate refresh token
  await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?`, [stored.id]);

  const newRefreshToken = generateRefreshToken();
  await storeRefreshToken(stored.user_type, stored.user_id, newRefreshToken);

  const accessToken = signAccessToken(user, role);

  return {
    accessToken,
    refreshToken: newRefreshToken,
    user: sanitizeUser(user, role),
  };
}

export async function logout(refreshToken, actor = {}) {
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?`, [tokenHash]);
  }

  if (actor.role && actor.id) {
    await logAudit({
      actorType: actor.role,
      actorId: actor.id,
      action: 'LOGOUT',
    });
  }
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] });
  } catch {
    throw new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');
  }
}

export { setRefreshCookie, clearRefreshCookie, REFRESH_COOKIE };
