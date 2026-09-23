import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
export const MARKETING_ADS_DIR = path.join(UPLOADS_ROOT, 'marketing-ads');
export const KNOWLEDGE_DOCUMENTS_DIR = path.join(UPLOADS_ROOT, 'knowledge-documents');

export function ensureUploadDirs() {
  fs.mkdirSync(MARKETING_ADS_DIR, { recursive: true });
  fs.mkdirSync(KNOWLEDGE_DOCUMENTS_DIR, { recursive: true });
}

/**
 * Public URL path for uploaded files. Default `/api/uploads` so production nginx
 * can proxy a single `/api` location to Node (same as JSON APIs). Dev Vite proxies `/api` too.
 * Set PUBLIC_UPLOAD_BASE_PATH=/uploads if nginx exposes `/uploads` separately.
 */
export const PUBLIC_UPLOAD_BASE = (process.env.PUBLIC_UPLOAD_BASE_PATH || '/api/uploads').replace(
  /\/$/,
  ''
);

export function marketingAdPublicUrl(filename) {
  if (!filename) return null;
  return `${PUBLIC_UPLOAD_BASE}/marketing-ads/${filename}`;
}
