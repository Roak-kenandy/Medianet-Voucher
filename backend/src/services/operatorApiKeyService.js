import crypto from 'crypto';
import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { hashToken } from '../utils/crypto.js';
import { logAudit } from './auditService.js';

const KEY_LABEL = 'mtvop';
const MAX_ACTIVE_KEYS_PER_OPERATOR = 5;

/** `mtvop_<8 hex id>_<43 char secret>`; the id part is stored in clear so a key can be recognised. */
function generateApiKey() {
  const keyId = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  return { key: `${KEY_LABEL}_${keyId}_${secret}`, prefix: `${KEY_LABEL}_${keyId}` };
}

function mapKeyRow(row) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    createdAt: row.created_at,
    createdByName: row.created_by_name || null,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    isActive: !row.revoked_at,
  };
}

async function assertOperatorExists(operatorId, executor) {
  const [rows] = await executor.execute('SELECT id FROM operators WHERE id = ? LIMIT 1', [operatorId]);
  if (!rows.length) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }
}

/**
 * Issues a key for an operator. `connection` lets operator creation issue the first key in
 * its own transaction. The returned `apiKey` is the only time the full key is available.
 */
export async function createOperatorApiKey(adminId, operatorId, { name } = {}, reqMeta = {}, connection = null) {
  const executor = connection || { execute: (sql, params) => query(sql, params).then((rows) => [rows]) };
  await assertOperatorExists(operatorId, executor);

  const [activeRows] = await executor.execute(
    'SELECT COUNT(*) AS total FROM operator_api_keys WHERE operator_id = ? AND revoked_at IS NULL',
    [operatorId]
  );
  if (Number(activeRows[0]?.total) >= MAX_ACTIVE_KEYS_PER_OPERATOR) {
    throw new AppError(
      `An operator can have at most ${MAX_ACTIVE_KEYS_PER_OPERATOR} active API keys. Revoke one first.`,
      400,
      'API_KEY_LIMIT'
    );
  }

  const { key, prefix } = generateApiKey();
  const keyName = String(name || '').trim() || 'API key';
  const [result] = await executor.execute(
    `INSERT INTO operator_api_keys (operator_id, name, key_prefix, key_hash, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?)`,
    [operatorId, keyName, prefix, hashToken(key), adminId]
  );
  // Issuing a key is the decision to let this operator use the API.
  await executor.execute('UPDATE operators SET api_access_enabled = 1 WHERE id = ?', [operatorId]);

  // Inside the operator-creation transaction the caller's own audit entry records the key.
  if (!connection) await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'OPERATOR_API_KEY_CREATED',
    resourceType: 'operator',
    resourceId: operatorId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { apiKeyId: result.insertId, keyPrefix: prefix, name: keyName },
  });

  return {
    id: result.insertId,
    name: keyName,
    keyPrefix: prefix,
    apiKey: key,
    isActive: true,
  };
}

export async function listOperatorApiKeys(operatorId) {
  const rows = await query(
    `SELECT k.id, k.name, k.key_prefix, k.created_at, k.last_used_at, k.revoked_at,
            a.name AS created_by_name
     FROM operator_api_keys k
     LEFT JOIN admins a ON a.id = k.created_by_admin_id
     WHERE k.operator_id = ?
     ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC
     LIMIT 50`,
    [operatorId]
  );
  return rows.map(mapKeyRow);
}

export async function revokeOperatorApiKey(adminId, operatorId, keyId, reqMeta = {}) {
  const result = await query(
    `UPDATE operator_api_keys
     SET revoked_at = NOW(), revoked_by_admin_id = ?
     WHERE id = ? AND operator_id = ? AND revoked_at IS NULL`,
    [adminId, keyId, operatorId]
  );
  if (!result.affectedRows) {
    throw new AppError('API key not found or already revoked', 404, 'NOT_FOUND');
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'OPERATOR_API_KEY_REVOKED',
    resourceType: 'operator',
    resourceId: operatorId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { apiKeyId: keyId },
  });

  return { id: keyId, revoked: true };
}

export async function getOperatorApiAccess(operatorId) {
  const rows = await query('SELECT api_access_enabled FROM operators WHERE id = ? LIMIT 1', [operatorId]);
  if (!rows.length) throw new AppError('Operator not found', 404, 'NOT_FOUND');
  return Boolean(rows[0].api_access_enabled);
}

/**
 * Turns the Operator API on or off for one operator. Off blocks every key the operator holds
 * (without revoking them) and hides the developer documentation from its users.
 */
export async function setOperatorApiAccess(adminId, operatorId, enabled, reqMeta = {}) {
  const result = await query('UPDATE operators SET api_access_enabled = ? WHERE id = ?', [
    enabled ? 1 : 0,
    operatorId,
  ]);
  if (!result.affectedRows && !(await query('SELECT id FROM operators WHERE id = ?', [operatorId])).length) {
    throw new AppError('Operator not found', 404, 'NOT_FOUND');
  }
  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: enabled ? 'OPERATOR_API_ACCESS_ENABLED' : 'OPERATOR_API_ACCESS_DISABLED',
    resourceType: 'operator',
    resourceId: operatorId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
  });
  return { apiAccessEnabled: Boolean(enabled) };
}
