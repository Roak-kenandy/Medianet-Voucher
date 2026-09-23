import fs from 'fs';
import path from 'path';
import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { MARKETING_ADS_DIR, marketingAdPublicUrl } from '../config/uploads.js';

function mapAdRow(row) {
  if (!row) return null;
  const now = new Date();
  const start = new Date(row.display_start);
  const end = row.display_end ? new Date(row.display_end) : null;
  let scheduleStatus = 'inactive';
  if (row.is_active) {
    if (now < start) scheduleStatus = 'scheduled';
    else if (end && now > end) scheduleStatus = 'ended';
    else scheduleStatus = 'live';
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    imageUrl: marketingAdPublicUrl(row.image_filename),
    imageFilename: row.image_filename,
    linkUrl: row.link_url || null,
    displayStart: row.display_start,
    displayEnd: row.display_end,
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
    scheduleStatus,
    createdByAdminId: row.created_by_admin_id,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const LIST_SELECT = `
  SELECT ma.*, a.name AS created_by_name
  FROM marketing_ads ma
  LEFT JOIN admins a ON a.id = ma.created_by_admin_id
`;

export async function listMarketingAds() {
  const rows = await query(
    `${LIST_SELECT}
     ORDER BY ma.sort_order ASC, ma.display_start DESC, ma.id DESC`
  );
  return rows.map(mapAdRow);
}

export async function listLiveMarketingAdsForOperators() {
  const rows = await query(
    `${LIST_SELECT}
     WHERE ma.is_active = 1
       AND ma.display_start <= NOW()
       AND (ma.display_end IS NULL OR ma.display_end >= NOW())
     ORDER BY ma.sort_order ASC, ma.display_start DESC, ma.id DESC`
  );
  return rows.map(mapAdRow);
}

export async function createMarketingAd(adminId, data, imageFilename) {
  if (!imageFilename) {
    throw new AppError('Ad image is required', 400, 'VALIDATION_ERROR');
  }

  const result = await query(
    `INSERT INTO marketing_ads
       (title, description, image_filename, link_url, display_start, display_end,
        sort_order, is_active, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.title,
      data.description || null,
      imageFilename,
      data.linkUrl || null,
      data.displayStart,
      data.displayEnd || null,
      data.sortOrder ?? 0,
      data.isActive !== false ? 1 : 0,
      adminId,
    ]
  );

  const [row] = await query(`${LIST_SELECT} WHERE ma.id = ? LIMIT 1`, [result.insertId]);
  return mapAdRow(row);
}

export async function updateMarketingAd(adId, data, imageFilename = null) {
  const [existing] = await query(`SELECT * FROM marketing_ads WHERE id = ? LIMIT 1`, [adId]);
  if (!existing) {
    throw new AppError('Marketing ad not found', 404, 'NOT_FOUND');
  }

  const nextFilename = imageFilename || existing.image_filename;

  await query(
    `UPDATE marketing_ads
     SET title = ?, description = ?, image_filename = ?, link_url = ?,
         display_start = ?, display_end = ?, sort_order = ?, is_active = ?
     WHERE id = ?`,
    [
      data.title,
      data.description || null,
      nextFilename,
      data.linkUrl || null,
      data.displayStart,
      data.displayEnd || null,
      data.sortOrder ?? 0,
      data.isActive !== false ? 1 : 0,
      adId,
    ]
  );

  if (imageFilename && imageFilename !== existing.image_filename) {
    deleteMarketingAdFile(existing.image_filename);
  }

  const [row] = await query(`${LIST_SELECT} WHERE ma.id = ? LIMIT 1`, [adId]);
  return mapAdRow(row);
}

export async function deleteMarketingAd(adId) {
  const [existing] = await query(`SELECT * FROM marketing_ads WHERE id = ? LIMIT 1`, [adId]);
  if (!existing) {
    throw new AppError('Marketing ad not found', 404, 'NOT_FOUND');
  }

  await query(`DELETE FROM marketing_ads WHERE id = ?`, [adId]);
  deleteMarketingAdFile(existing.image_filename);
  return { id: adId };
}

function deleteMarketingAdFile(filename) {
  if (!filename) return;
  const filePath = path.join(MARKETING_ADS_DIR, filename);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore missing files
  }
}
