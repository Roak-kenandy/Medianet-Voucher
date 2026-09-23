import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { AppError } from '../utils/errors.js';
import { MARKETING_ADS_DIR, ensureUploadDirs } from '../config/uploads.js';

ensureUploadDirs();

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    ensureUploadDirs();
    cb(null, MARKETING_ADS_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, `${randomUUID()}${safeExt}`);
  },
});

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    cb(new AppError('Only JPG, PNG, or WebP images are allowed', 400, 'VALIDATION_ERROR'));
    return;
  }
  cb(null, true);
}

export const marketingAdUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});
