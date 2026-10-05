import crypto from 'crypto';
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

/** Table that holds the login row (password, lock counters) for a role. */
function getTableForRole(role) {
  if (isStaffRole(role) || role === 'admin') return 'admins';
  return 'operator_users';
}

/**
 * Id of the login row. For operators the principal's `id` is the operator (tenant) id that
 * every operator route scopes by, while the login itself is one of that operator's users.
 */
function loginIdOf(role, user) {
  return role === 'operator' ? user.operator_user_id : user.id;
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

/**
 * Loads an operator user together with its operator. The result is shaped like the operator
 * row (`id` is the operator id), with the login fields taken from the user: name, email,
 * password hash, portal role and permissions, credentials version. `is_active` is true only
 * when both the user and the operator are active.
 */
async function findOperatorPrincipal(operatorUserId) {
  const users = await query(`SELECT * FROM operator_users WHERE id = ? LIMIT 1`, [operatorUserId]);
  const operatorUser = users[0];
  if (!operatorUser) return null;

  const operators = await query(`SELECT * FROM operators WHERE id = ? LIMIT 1`, [operatorUser.operator_id]);
  const operator = operators[0];
  if (!operator) return null;

  const packages = await getOperatorPackages(operator.id);
  return {
    ...operator,
    operator_user_id: operatorUser.id,
    name: operatorUser.name,
    email: operatorUser.email,
    password_hash: operatorUser.password_hash,
    portal_role: operatorUser.portal_role,
    portal_permissions: operatorUser.portal_permissions,
    credentials_version: operatorUser.credentials_version,
    is_active: operator.is_active && operatorUser.is_active ? 1 : 0,
    operator_packages: packages,
    package_name: packages.map((pkg) => pkg.name).join(', ') || operator.package_type,
  };
}

/** For role `operator`, `id` is the operator *user* id (the login), not the operator id. */
export async function findUserById(role, id) {
  if (role === 'operator') {
    return findOperatorPrincipal(id);
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
 * exceed the account-wide ceiling. Returns false when the account is locked.
 *
 * The per-source block is the login rate limiter (email + client address). This account-wide
 * counter is a much higher ceiling over a rolling window, so a single client cannot lock the
 * real owner out, while a distributed guessing run is still stopped.
 */
async function claimLoginAttempt(role, userId) {
  const table = getTableForRole(role);
  const { accountLockThreshold, lockoutMinutes } = config.security;

  // Expired lock, expired counting window, or a legacy counter stuck without a lock.
  await query(
    `UPDATE ${table}
     SET failed_login_attempts = 0, locked_until = NULL, failed_login_window_start = NULL
     WHERE id = ?
       AND ((locked_until IS NOT NULL AND locked_until <= NOW())
         OR (locked_until IS NULL AND failed_login_window_start IS NOT NULL
             AND failed_login_window_start <= NOW() - INTERVAL ? MINUTE)
         OR (locked_until IS NULL AND failed_login_window_start IS NULL AND failed_login_attempts > 0))`,
    [userId, lockoutMinutes]
  );

  // The counter and the lock are written by one statement, so the threshold can never be
  // reached without the lock timestamp. (MySQL applies SET assignments left to right.)
  const result = await query(
    `UPDATE ${table}
     SET failed_login_window_start = COALESCE(failed_login_window_start, NOW()),
         failed_login_attempts = failed_login_attempts + 1,
         locked_until = IF(failed_login_attempts >= ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NULL)
     WHERE id = ? AND locked_until IS NULL AND failed_login_attempts < ?`,
    [accountLockThreshold, lockoutMinutes, userId, accountLockThreshold]
  );
  return result.affectedRows === 1;
}

async function resetFailedLogin(role, userId) {
  const table = getTableForRole(role);
  await query(
    `UPDATE ${table}
     SET failed_login_attempts = 0, locked_until = NULL, failed_login_window_start = NULL
     WHERE id = ?`,
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
    // sub stays the operator (tenant) id; uid identifies which of its users signed in.
    payload.uid = user.operator_user_id;
    payload.clientName = user.client_name;
  }

  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
    algorithm: 'HS256',
  });
}

function newTokenFamilyId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * `credentialsVersion` must come from the user row the issuing request actually read, so a
 * token minted across a concurrent password reset carries the old version and is refused.
 * `familyId` ties every rotation of one login together for reuse detection.
 */
async function storeRefreshToken(role, userId, token, { credentialsVersion, familyId }) {
  const tokenHash = hashToken(token);
  const expiresMs = parseDurationToMs(config.jwt.refreshExpiresIn);
  const expiresAt = new Date(Date.now() + expiresMs);

  await query(
    `INSERT INTO refresh_tokens
       (user_type, user_id, token_hash, expires_at, credentials_version, family_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [role, userId, tokenHash, expiresAt, Number(credentialsVersion) || 0, familyId]
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
    `SELECT u.id
     FROM operator_users u
     JOIN operators o ON o.id = u.operator_id
     WHERE u.email = ? AND u.is_active = 1 AND o.is_active = 1
     LIMIT 1`,
    [normalizedEmail]
  );
  if (rows[0]) return { user: rows[0], role: 'operator' };

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
  if (!user) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }
  const loginId = loginIdOf(role, user);

  if (!(await claimLoginAttempt(role, loginId))) {
    throw new AppError(
      'Account temporarily locked due to too many failed attempts. Try again later.',
      423,
      'ACCOUNT_LOCKED'
    );
  }

  const passwordValid = await bcrypt.compare(password, user.password_hash);

  if (!passwordValid) {
    await logAudit({
      actorType: role,
      actorId: user.id,
      action: 'LOGIN_FAILED',
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent,
      metadata: role === 'operator' ? { operatorUserId: loginId } : null,
    });
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  await resetFailedLogin(role, loginId);
  if (role === 'operator') {
    await query(`UPDATE operator_users SET last_login_at = NOW() WHERE id = ?`, [loginId]);
  }

  const accessToken = signAccessToken(user, role);
  const refreshToken = generateRefreshToken();
  await storeRefreshToken(getRefreshUserType(role), loginId, refreshToken, {
    credentialsVersion: user.credentials_version,
    familyId: newTokenFamilyId(),
  });

  await logAudit({
    actorType: isStaffRole(role) ? 'admin' : role,
    actorId: user.id,
    action: 'LOGIN_SUCCESS',
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: role === 'operator' ? { operatorUserId: loginId } : null,
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
  // Detection ends only the login session (family) the token belonged to, and fires once.
  const reusedRows = await query(
    `SELECT id, user_type, user_id, family_id,
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
    if (reusedRows[0].family_id) {
      await query(
        `UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = 'reuse'
         WHERE family_id = ? AND revoked_at IS NULL`,
        [reusedRows[0].family_id]
      );
    }
    await query(
      `UPDATE refresh_tokens SET revoked_reason = 'reuse' WHERE id = ? AND revoked_reason = 'rotated'`,
      [reusedRows[0].id]
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

  if ((Number(user.credentials_version) || 0) !== (Number(stored.credentials_version) || 0)) {
    await query(
      `UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = 'credentials_changed'
       WHERE id = ? AND revoked_at IS NULL`,
      [stored.id]
    );
    throw new AppError('Session expired. Please log in again.', 401, 'SESSION_REVOKED');
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
  await storeRefreshToken(stored.user_type, stored.user_id, newRefreshToken, {
    credentialsVersion: stored.credentials_version,
    familyId: stored.family_id || newTokenFamilyId(),
  });

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

/**
 * Checks stored hashes (not just the env var) for the shipped default admin password.
 * Returns the affected staff emails so start-up can refuse to serve in production.
 */
export async function findDefaultPasswordAdmins() {
  const admins = await query(`SELECT id, email, password_hash FROM admins WHERE is_active = 1`);
  const affected = [];
  for (const admin of admins) {
    for (const candidate of KNOWN_DEFAULT_PASSWORDS) {
      if (admin.password_hash && (await bcrypt.compare(candidate, admin.password_hash))) {
        affected.push(admin.email);
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
  return affected;
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
