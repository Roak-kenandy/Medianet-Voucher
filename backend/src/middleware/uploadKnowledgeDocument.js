import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { AppError } from '../utils/errors.js';
import { KNOWLEDGE_DOCUMENTS_DIR, ensureUploadDirs } from '../config/uploads.js';

ensureUploadDirs();

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const EXT_BY_MIME = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    ensureUploadDirs();
    cb(null, KNOWLEDGE_DOCUMENTS_DIR);
  },
  filename(_req, file, cb) {
    const ext =
      EXT_BY_MIME[file.mimetype] ||
      path.extname(file.originalname || '').toLowerCase() ||
      '.pdf';
    cb(null, `${randomUUID()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    cb(new AppError('Only PDF or Word documents are allowed', 400, 'VALIDATION_ERROR'));
    return;
  }
  cb(null, true);
}

export const knowledgeDocumentUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024 },
});
