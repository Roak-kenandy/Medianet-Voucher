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

/** Rotated tokens replayed within this window are treated as a cross-tab race, not theft. */
const REFRESH_REUSE_GRACE_SECONDS = 30;

let dummyPasswordHashPromise = null;
function getDummyPasswordHash() {
  if (!dummyPasswordHashPromise) {
    dummyPasswordHashPromise = bcrypt.hash('timing-equalizer-not-a-real-password', config.security.bcryptRounds);
  }
  return dummyPasswordHashPromise;
}

/**
 * Atomically reserves one password attempt before bcrypt runs, so parallel guesses cannot
 * exceed the lockout threshold. Returns false when the account is locked.
 */
async function claimLoginAttempt(role, userId) {
  const table = getTableForRole(role);
  await query(
    `UPDATE ${table} SET failed_login_attempts = 0, locked_until = NULL
     WHERE id = ? AND locked_until IS NOT NULL AND locked_until <= NOW()`,
    [userId]
  );
  const result = await query(
    `UPDATE ${table} SET failed_login_attempts = failed_login_attempts + 1
     WHERE id = ? AND locked_until IS NULL AND failed_login_attempts < ?`,
    [userId, config.security.maxLoginAttempts]
  );
  return result.affectedRows === 1;
}

async function lockIfThresholdReached(role, userId) {
  const table = getTableForRole(role);
  await query(
    `UPDATE ${table} SET locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE)
     WHERE id = ? AND locked_until IS NULL AND failed_login_attempts >= ?`,
    [config.security.lockoutMinutes, userId, config.security.maxLoginAttempts]
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
    cv: Number(user.credentials_version) || 0,
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
    // Same bcrypt cost as a real account so response time does not reveal which emails exist.
    await bcrypt.compare(password, await getDummyPasswordHash());
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const { user: rawUser, role } = resolved;
  const user = role === 'operator' ? await findUserById('operator', rawUser.id) : rawUser;

  if (!(await claimLoginAttempt(role, user.id))) {
    throw new AppError(
      'Account temporarily locked due to too many failed attempts. Try again later.',
      423,
      'ACCOUNT_LOCKED'
    );
  }

  const passwordValid = await bcrypt.compare(password, user.password_hash);

  if (!passwordValid) {
    await lockIfThresholdReached(role, user.id);
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

  // Only a *rotated*, still-unexpired token being replayed signals theft. Logged-out, reset or
  // expired tokens are simply rejected so an old cookie cannot be used to log a user out.
  const reusedRows = await query(
    `SELECT user_type, user_id,
            revoked_at > NOW() - INTERVAL ${REFRESH_REUSE_GRACE_SECONDS} SECOND AS withinGrace
     FROM refresh_tokens
     WHERE token_hash = ? AND revoked_at IS NOT NULL
       AND revoked_reason = 'rotated' AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );

  if (reusedRows[0]) {
    if (Number(reusedRows[0].withinGrace) === 1) {
      throw new AppError('Session was just refreshed in another tab. Retry.', 401, 'REFRESH_RACE');
    }
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = 'reuse'
       WHERE user_type = ? AND user_id = ? AND revoked_at IS NULL`,
      [reusedRows[0].user_type, reusedRows[0].user_id]
    );
    await logAudit({
      actorType: reusedRows[0].user_type,
      actorId: reusedRows[0].user_id,
      action: 'REFRESH_TOKEN_REUSE_DETECTED',
      metadata: { reason: 'rotated_token_reused' },
    });
    throw new AppError('Session expired. Please log in again.', 401, 'SESSION_REVOKED');
  }

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
  const revokeResult = await query(
    `UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = 'rotated'
     WHERE id = ? AND revoked_at IS NULL`,
    [stored.id]
  );
  if (!revokeResult.affectedRows) {
    throw new AppError('Session expired. Please log in again.', 401, 'SESSION_REVOKED');
  }

  const newRefreshToken = generateRefreshToken();
  await storeRefreshToken(stored.user_type, stored.user_id, newRefreshToken);

  const accessToken = signAccessToken(user, role);

  return {
    accessToken,
    refreshToken: newRefreshToken,
    user: sanitizeUser(user, role),
  };
}

export async function revokeAllRefreshTokens(userType, userId, reason = 'admin') {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = ?
     WHERE user_type = ? AND user_id = ? AND revoked_at IS NULL`,
    [reason, userType, userId]
  );
}

const KNOWN_DEFAULT_PASSWORDS = ['ChangeMe@Secure123'];

/** Checks stored hashes (not just the env var) for the shipped default admin password. */
export async function warnIfDefaultAdminPassword() {
  const admins = await query(`SELECT id, email, password_hash FROM admins WHERE is_active = 1`);
  for (const admin of admins) {
    for (const candidate of KNOWN_DEFAULT_PASSWORDS) {
      if (admin.password_hash && (await bcrypt.compare(candidate, admin.password_hash))) {
        const log = config.env === 'production' ? console.error : console.warn;
        log(
          `[Security] Staff account ${admin.email} still uses the default seed password. Change it immediately.`
        );
        await logAudit({
          actorType: 'system',
          actorId: null,
          action: 'DEFAULT_ADMIN_PASSWORD_DETECTED',
          resourceType: 'admin',
          resourceId: admin.id,
        });
      }
    }
  }
}

export async function purgeExpiredRefreshTokens() {
  const result = await query(
    `DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL 1 DAY LIMIT 5000`
  );
  return result.affectedRows || 0;
}

export async function logout(refreshToken, actor = {}, reqMeta = {}) {
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = 'logout'
       WHERE token_hash = ? AND revoked_at IS NULL`,
      [tokenHash]
    );
  }

  if (actor.role && actor.id) {
    await logAudit({
      actorType: actor.role,
      actorId: actor.id,
      action: 'LOGOUT',
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
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
