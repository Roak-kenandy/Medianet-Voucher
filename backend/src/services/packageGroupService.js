import { query, getConnection } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { logAudit } from './auditService.js';
import { assertPackagesAssignable } from './packageService.js';

function uniqueIds(ids = []) {
  return [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
}

async function assertGroupNameFree(name, excludeGroupId = null) {
  const rows =
    excludeGroupId != null
      ? await query('SELECT id FROM package_groups WHERE name = ? AND id != ? LIMIT 1', [name, excludeGroupId])
      : await query('SELECT id FROM package_groups WHERE name = ? LIMIT 1', [name]);
  if (rows.length) {
    throw new AppError('A package group with this name already exists', 409, 'PACKAGE_GROUP_EXISTS');
  }
}

/** Every group with its packages and the operators that use it. */
export async function listPackageGroups() {
  const groups = await query(
    `SELECT g.id, g.name, g.description, g.created_at, g.updated_at
     FROM package_groups g
     ORDER BY g.name ASC`
  );
  if (!groups.length) return [];

  const items = await query(
    `SELECT gi.group_id, p.id, p.name, p.service_tag, p.sales_model_id, sm.name AS sales_model_name,
            p.price_amount, p.currency_code, p.is_active
     FROM package_group_items gi
     INNER JOIN packages p ON p.id = gi.package_id
     LEFT JOIN sales_models sm ON sm.id = p.sales_model_id
     ORDER BY p.name ASC`
  );
  const operators = await query(
    `SELECT og.group_id, o.id, o.client_name, o.is_active
     FROM operator_package_groups og
     INNER JOIN operators o ON o.id = og.operator_id
     ORDER BY o.client_name ASC`
  );

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    description: group.description,
    createdAt: group.created_at,
    updatedAt: group.updated_at,
    packages: items
      .filter((item) => item.group_id === group.id)
      .map((item) => ({
        id: item.id,
        name: item.name,
        serviceTag: item.service_tag || 'OTT',
        salesModelId: item.sales_model_id ?? null,
        salesModelName: item.sales_model_name || null,
        priceAmount: Number(item.price_amount),
        currencyCode: item.currency_code,
        isActive: Boolean(item.is_active),
      })),
    operators: operators
      .filter((op) => op.group_id === group.id)
      .map((op) => ({ id: op.id, clientName: op.client_name, isActive: Boolean(op.is_active) })),
  }));
}

async function getPackageGroupOrThrow(groupId) {
  const groups = await listPackageGroups();
  const group = groups.find((item) => item.id === Number(groupId));
  if (!group) {
    throw new AppError('Package group not found', 404, 'NOT_FOUND');
  }
  return group;
}

async function replaceGroupItems(connection, groupId, packageIds) {
  await connection.execute('DELETE FROM package_group_items WHERE group_id = ?', [groupId]);
  for (const packageId of packageIds) {
    await connection.execute('INSERT INTO package_group_items (group_id, package_id) VALUES (?, ?)', [
      groupId,
      packageId,
    ]);
  }
}

export async function createPackageGroup(adminId, data, reqMeta = {}) {
  const name = data.name.trim();
  await assertGroupNameFree(name);
  const packageIds = uniqueIds(data.packageIds);
  if (packageIds.length) await assertPackagesAssignable(packageIds);

  const connection = await getConnection();
  let groupId;
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO package_groups (name, description, created_by_admin_id) VALUES (?, ?, ?)`,
      [name, data.description?.trim() || null, adminId]
    );
    groupId = result.insertId;
    await replaceGroupItems(connection, groupId, packageIds);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    if (err?.code === 'ER_DUP_ENTRY') {
      throw new AppError('A package group with this name already exists', 409, 'PACKAGE_GROUP_EXISTS');
    }
    throw err;
  } finally {
    connection.release();
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'PACKAGE_GROUP_CREATED',
    resourceType: 'package_group',
    resourceId: groupId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { name, packageIds },
  });

  return getPackageGroupOrThrow(groupId);
}

/**
 * Changing a group's packages changes what every operator in the group can sell. Packages
 * that stay in the group may be inactive already; only newly added ones must be assignable.
 */
export async function updatePackageGroup(adminId, groupId, data, reqMeta = {}) {
  const current = await getPackageGroupOrThrow(groupId);
  const name = data.name.trim();
  if (name !== current.name) await assertGroupNameFree(name, groupId);

  const packageIds = uniqueIds(data.packageIds);
  const currentIds = current.packages.map((pkg) => pkg.id);
  const added = packageIds.filter((id) => !currentIds.includes(id));
  const removed = currentIds.filter((id) => !packageIds.includes(id));
  if (added.length) await assertPackagesAssignable(added);

  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`UPDATE package_groups SET name = ?, description = ? WHERE id = ?`, [
      name,
      data.description?.trim() || null,
      groupId,
    ]);
    await replaceGroupItems(connection, groupId, packageIds);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    if (err?.code === 'ER_DUP_ENTRY') {
      throw new AppError('A package group with this name already exists', 409, 'PACKAGE_GROUP_EXISTS');
    }
    throw err;
  } finally {
    connection.release();
  }

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'PACKAGE_GROUP_UPDATED',
    resourceType: 'package_group',
    resourceId: groupId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: {
      name,
      addedPackageIds: added,
      removedPackageIds: removed,
      affectedOperatorIds: current.operators.map((op) => op.id),
    },
  });

  return getPackageGroupOrThrow(groupId);
}

/** A group can be deleted only when no operator uses it, so nobody loses packages by surprise. */
export async function deletePackageGroup(adminId, groupId, reqMeta = {}) {
  const current = await getPackageGroupOrThrow(groupId);
  if (current.operators.length) {
    throw new AppError(
      `This group is used by ${current.operators.length} operator(s). Remove it from them first.`,
      400,
      'PACKAGE_GROUP_IN_USE'
    );
  }

  await query('DELETE FROM package_groups WHERE id = ?', [groupId]);

  await logAudit({
    actorType: 'admin',
    actorId: adminId,
    action: 'PACKAGE_GROUP_DELETED',
    resourceType: 'package_group',
    resourceId: groupId,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
    metadata: { name: current.name },
  });

  return { id: Number(groupId), deleted: true };
}

/** Validates that every id is an existing group and returns them (id, name). */
export async function assertPackageGroupsExist(groupIds = []) {
  const ids = uniqueIds(groupIds);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await query(`SELECT id, name FROM package_groups WHERE id IN (${placeholders})`, ids);
  if (rows.length !== ids.length) {
    throw new AppError('One or more package groups do not exist', 400, 'PACKAGE_GROUP_NOT_FOUND');
  }
  return rows;
}

export async function syncOperatorPackageGroups(operatorId, groupIds, connection) {
  await connection.execute('DELETE FROM operator_package_groups WHERE operator_id = ?', [operatorId]);
  for (const groupId of uniqueIds(groupIds)) {
    await connection.execute('INSERT INTO operator_package_groups (operator_id, group_id) VALUES (?, ?)', [
      operatorId,
      groupId,
    ]);
  }
}

/** Groups per operator for the admin list. */
export async function getPackageGroupsByOperatorIds(operatorIds = []) {
  if (!operatorIds.length) return new Map();
  const placeholders = operatorIds.map(() => '?').join(', ');
  const rows = await query(
    `SELECT og.operator_id, g.id, g.name
     FROM operator_package_groups og
     INNER JOIN package_groups g ON g.id = og.group_id
     WHERE og.operator_id IN (${placeholders})
     ORDER BY g.name ASC`,
    operatorIds
  );
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.operator_id)) map.set(row.operator_id, []);
    map.get(row.operator_id).push({ id: row.id, name: row.name });
  }
  return map;
}
