import bcrypt from 'bcrypt';
import { config } from '../config/index.js';
import { query, getConnection } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { logAudit } from './auditService.js';
import { normalizePortalRole, parseOperatorPermissions } from '../constants/operatorPermissions.js';

/** Supervisors have every permission, so nothing is stored for them. */
export function serializePortalPermissions(portalRole, portalPermissions) {
  if (normalizePortalRole(portalRole) === 'supervisor') return null;
  return JSON.stringify(parseOperatorPermissions('user', portalPermissions));
}

/** A login email must be unique across staff and every operator user. */
export async function loginEmailExists(email, { excludeOperatorUserId = null } = {}) {
  const normalized = email.toLowerCase().trim();
  const admins = await query('SELECT id FROM admins WHERE email = ? LIMIT 1', [normalized]);
  if (admins.length) return true;

  const users =
    excludeOperatorUserId != null
      ? await query('SELECT id FROM operator_users WHERE email = ? AND id != ? LIMIT 1', [
          normalized,
          excludeOperatorUserId,
        ])
      : await query('SELECT id FROM operator_users WHERE email = ? LIMIT 1', [normalized]);
  return users.length > 0;
}

/**
 * Ends every session of one operator user inside the caller's transaction: live refresh
 * tokens are revoked, older rotated tokens can no longer trigger reuse detection, and the
 * credentials version bump rejects outstanding access tokens on their next request.
 */
export async function endOperatorUserSessions(connection, operatorUserId, reason) {
  await connection.execute(
    `UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = ?
     WHERE user_type = 'operator' AND user_id = ? AND revoked_at IS NULL`,
    [reason, operatorUserId]
  );
  await connection.execute(
    `UPDATE refresh_tokens SET revoked_reason = 'superseded'
     WHERE user_type = 'operator' AND user_id = ? AND revoked_reason = 'rotated'`,
    [operatorUserId]
  );
  await connection.execute(
    `UPDATE operator_users SET credentials_version = credentials_version + 1 WHERE id = ?`,
    [operatorUserId]
  );
}

/** Same as above for every user of one operator (operator deactivated). */
export async function endAllOperatorSessions(connection, operatorId, reason) {
  await connection.execute(
    `UPDATE refresh_tokens rt
     JOIN operator_users u ON u.id = rt.user_id
     SET rt.revoked_at = NOW(), rt.revoked_reason = ?
     WHERE rt.user_type = 'operator' AND u.operator_id = ? AND rt.revoked_at IS NULL`,
    [reason, operatorId]
  );
  await connection.execute(
    `UPDATE refresh_tokens rt
     JOIN operator_users u ON u.id = rt.user_id
     SET rt.revoked_reason = 'superseded'
     WHERE rt.user_type = 'operator' AND u.operator_id = ? AND rt.revoked_reason = 'rotated'`,
    [operatorId]
  );
  await connection.execute(
    `UPDATE operator_users SET credentials_version = credentials_version + 1 WHERE operator_id = ?`,
    [operatorId]
  );
}

/** Inserts a user row; the caller owns the transaction and has already checked the email. */
export async function insertOperatorUser(connection, operatorId, data, { passwordHash, adminId }) {
  const [result] = await connection.execute(
    `INSERT INTO operator_users
       (operator_id, name, email, password_hash, portal_role, portal_permissions, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      operatorId,
      data.name.trim(),
      data.email.toLowerCase().trim(),
      passwordHash,
      normalizePortalRole(data.portalRole),
      serializePortalPermissions(data.portalRole, data.portalPermissions),
      adminId,
    ]
  );
  return result.insertId;
}

function mapUserRow(row) {
  const portalRole = normalizePortalRole(row.portal_role);
  return {
    id: row.id,
    operatorId: row.operator_id,
    name: row.name,
    email: row.email,
    portalRole,
    portalPermissions: parseOperatorPermissions(portalRole, row.portal_permissions),
    isActive: Boolean(row.is_active),
    isLocked: Boolean(row.is_locked),
    lastLoginAt: row.last_login_at,
    activeSessions: Number(row.active_sessions) || 0,
    createdAt: row.created_at,
  };
}

const USER_COLUMNS = `u.id, u.operator_id, u.name, u.email, u.portal_role, u.portal_permissions,
  u.is_active, u.last_login_at, u.created_at,
  (u.locked_until IS NOT NULL AND u.locked_until > NOW()) AS is_locked,
  (SELECT COUNT(*) FROM refresh_tokens rt
    WHERE rt.user_type = 'operator' AND rt.user_id = u.id
      AND rt.revoked_at IS NULL AND rt.expires_at > NOW()) AS active_sessions`;

async function assertOperatorExists(operatorId) {
  const rows = await query('SELECT id, client_name FROM operators WHERE id = ? LIMIT 1', [operatorId]);
  if (!rows.length) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }
  return rows[0];
}

/** Every lookup is scoped by operator, so a user id from another operator is "not found". */
async function getOperatorUserOrThrow(operatorId, userId) {
  const rows = await query(
    `SELECT ${USER_COLUMNS} FROM operator_users u WHERE u.id = ? AND u.operator_id = ? LIMIT 1`,
    [userId, operatorId]
  );
  if (!rows.length) {
    throw new AppError('Operator user not found', 404, 'NOT_FOUND');
  }
  return rows[0];
}

export async function listOperatorUsers(operatorId) {
  const operator = await assertOperatorExists(operatorId);
  const rows = await query(
    `SELECT ${USER_COLUMNS} FROM operator_users u
     WHERE u.operator_id = ?
     ORDER BY u.is_active DESC, u.created_at ASC
     LIMIT 200`,
    [operatorId]
  );
  return { operatorId, clientName: operator.client_name, users: rows.map(mapUserRow) };
}

export async function createOperatorUser(adminId, operatorId, data, reqMeta = {}) {
  await assertOperatorExists(operatorId);
  if (await loginEmailExists(data.email)) {
    throw new AppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
  }

  const passwordHash = await bcrypt.hash(data.password, config.security.bcryptRounds);
  const connection = await getConnection();
  let userId;
  try {
    await connection.beginTransaction();
    userId = await insertOperatorUser(connection, operatorId, data, { passwordHash, adminId });
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    if (err?.code === 'ER_DUP_ENTRY') {
      throw new AppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
    }
    throw err;
  } finally {
    connection.release();
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'OPERATOR_USER_CREATED',
    resourceType: 'operator',
    resourceId: operatorId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { operatorUserId: userId, name: data.name.trim(), portalRole: normalizePortalRole(data.portalRole) },
  });

  return mapUserRow(await getOperatorUserOrThrow(operatorId, userId));
}

export async function updateOperatorUser(adminId, operatorId, userId, data, reqMeta = {}) {
  const current = await getOperatorUserOrThrow(operatorId, userId);
  const email = data.email.toLowerCase().trim();
  const emailChanged = email !== current.email;
  if (emailChanged && (await loginEmailExists(email, { excludeOperatorUserId: userId }))) {
    throw new AppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
  }

  const deactivated = Boolean(current.is_active) && !data.isActive;
  const activated = !current.is_active && data.isActive;

  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE operator_users
       SET name = ?, email = ?, portal_role = ?, portal_permissions = ?, is_active = ?
       WHERE id = ? AND operator_id = ?`,
      [
        data.name.trim(),
        email,
        normalizePortalRole(data.portalRole),
        serializePortalPermissions(data.portalRole, data.portalPermissions),
        data.isActive ? 1 : 0,
        userId,
        operatorId,
      ]
    );
    if (activated) {
      await connection.execute(
        `UPDATE operator_users
         SET failed_login_attempts = 0, locked_until = NULL, failed_login_window_start = NULL
         WHERE id = ?`,
        [userId]
      );
    }
    if (emailChanged || deactivated) {
      await endOperatorUserSessions(connection, userId, deactivated ? 'deactivated' : 'email_change');
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    if (err?.code === 'ER_DUP_ENTRY') {
      throw new AppError('An account with this email already exists', 409, 'EMAIL_EXISTS');
    }
    throw err;
  } finally {
    connection.release();
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'OPERATOR_USER_UPDATED',
    resourceType: 'operator',
    resourceId: operatorId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: {
      operatorUserId: userId,
      portalRole: normalizePortalRole(data.portalRole),
      isActive: Boolean(data.isActive),
      emailChanged,
    },
  });

  return mapUserRow(await getOperatorUserOrThrow(operatorId, userId));
}

/** Staff reset: sets a new password, clears any login lock and ends the user's sessions. */
export async function resetOperatorUserPassword(adminId, operatorId, userId, newPassword, reqMeta = {}) {
  await getOperatorUserOrThrow(operatorId, userId);
  const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);

  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE operator_users
       SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL, failed_login_window_start = NULL
       WHERE id = ? AND operator_id = ?`,
      [passwordHash, userId, operatorId]
    );
    await endOperatorUserSessions(connection, userId, 'password_reset');
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'OPERATOR_USER_PASSWORD_RESET',
    resourceType: 'operator',
    resourceId: operatorId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { operatorUserId: userId },
  });

  return { id: userId, operatorId };
}
