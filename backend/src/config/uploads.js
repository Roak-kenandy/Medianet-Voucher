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

export function marketingAdPublicUrl(filename) {
  if (!filename) return null;
  return `/uploads/marketing-ads/${filename}`;
}
