import { query } from '../db/pool.js';

/** audit_logs.actor_type ENUM only allows admin | operator | system */
export function normalizeAuditActorType(role) {
  if (role === 'operator' || role === 'admin' || role === 'system') {
    return role;
  }
  if (role === 'sales' || role === 'finance') {
    return 'admin';
  }
  return 'admin';
}

export async function logAudit({
  actorType,
  actorId = null,
  action,
  resourceType = null,
  resourceId = null,
  ipAddress = null,
  userAgent = null,
  metadata = null,
}) {
  const normalizedActorType = normalizeAuditActorType(actorType);

  try {
    await query(
      `INSERT INTO audit_logs
        (actor_type, actor_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedActorType,
        actorId,
        action,
        resourceType,
        resourceId,
        ipAddress,
        userAgent?.slice(0, 512) || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (err) {
    console.error('[Audit Log Error]', err.message);
  }
}

export function getClientMeta(req) {
  return {
    ipAddress: req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || null,
    userAgent: req.headers['user-agent'] || null,
  };
}
