import fs from 'fs';
import path from 'path';
import { query } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { KNOWLEDGE_DOCUMENTS_DIR } from '../config/uploads.js';

const LIST_SELECT = `
  SELECT kd.*, a.name AS created_by_name
  FROM knowledge_documents kd
  LEFT JOIN admins a ON a.id = kd.created_by_admin_id
`;

function mapDocumentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    fileOriginalName: row.file_original_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    sortOrder: row.sort_order,
    isActive: Boolean(row.is_active),
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listKnowledgeDocuments() {
  const rows = await query(
    `${LIST_SELECT}
     ORDER BY kd.sort_order ASC, kd.title ASC, kd.id DESC`
  );
  return rows.map(mapDocumentRow);
}

export async function listActiveKnowledgeDocumentsForOperators() {
  const rows = await query(
    `${LIST_SELECT}
     WHERE kd.is_active = 1
     ORDER BY kd.sort_order ASC, kd.title ASC, kd.id DESC`
  );
  return rows.map(mapDocumentRow);
}

export async function getKnowledgeDocumentFile(id, { activeOnly = false } = {}) {
  const [row] = await query(`SELECT * FROM knowledge_documents WHERE id = ? LIMIT 1`, [id]);
  if (!row) {
    throw new AppError('Document not found', 404, 'NOT_FOUND');
  }
  if (activeOnly && !row.is_active) {
    throw new AppError('Document not found', 404, 'NOT_FOUND');
  }

  const filePath = path.join(KNOWLEDGE_DOCUMENTS_DIR, row.file_filename);
  if (!fs.existsSync(filePath)) {
    throw new AppError('Document file is missing', 404, 'NOT_FOUND');
  }

  return { row, filePath };
}

export async function createKnowledgeDocument(adminId, data, file) {
  if (!file) {
    throw new AppError('Document file is required', 400, 'VALIDATION_ERROR');
  }

  const result = await query(
    `INSERT INTO knowledge_documents
       (title, description, file_filename, file_original_name, mime_type, file_size,
        sort_order, is_active, created_by_admin_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.title,
      data.description || null,
      file.filename,
      file.originalname,
      file.mimetype,
      file.size,
      data.sortOrder ?? 0,
      data.isActive !== false ? 1 : 0,
      adminId,
    ]
  );

  const [created] = await query(`${LIST_SELECT} WHERE kd.id = ? LIMIT 1`, [result.insertId]);
  return mapDocumentRow(created);
}

export async function updateKnowledgeDocument(id, data, file = null) {
  const [existing] = await query(`SELECT * FROM knowledge_documents WHERE id = ? LIMIT 1`, [id]);
  if (!existing) {
    throw new AppError('Document not found', 404, 'NOT_FOUND');
  }

  const nextFilename = file ? file.filename : existing.file_filename;
  const nextOriginal = file ? file.originalname : existing.file_original_name;
  const nextMime = file ? file.mimetype : existing.mime_type;
  const nextSize = file ? file.size : existing.file_size;

  await query(
    `UPDATE knowledge_documents
     SET title = ?, description = ?, file_filename = ?, file_original_name = ?,
         mime_type = ?, file_size = ?, sort_order = ?, is_active = ?
     WHERE id = ?`,
    [
      data.title,
      data.description || null,
      nextFilename,
      nextOriginal,
      nextMime,
      nextSize,
      data.sortOrder ?? 0,
      data.isActive !== false ? 1 : 0,
      id,
    ]
  );

  if (file && file.filename !== existing.file_filename) {
    deleteKnowledgeFile(existing.file_filename);
  }

  const [updated] = await query(`${LIST_SELECT} WHERE kd.id = ? LIMIT 1`, [id]);
  return mapDocumentRow(updated);
}

export async function deleteKnowledgeDocument(id) {
  const [existing] = await query(`SELECT * FROM knowledge_documents WHERE id = ? LIMIT 1`, [id]);
  if (!existing) {
    throw new AppError('Document not found', 404, 'NOT_FOUND');
  }

  await query(`DELETE FROM knowledge_documents WHERE id = ?`, [id]);
  deleteKnowledgeFile(existing.file_filename);
  return { id };
}

function deleteKnowledgeFile(filename) {
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(KNOWLEDGE_DOCUMENTS_DIR, filename));
  } catch {
    // ignore
  }
}
