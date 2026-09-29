import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_ROOT = path.join(__dirname, '../../uploads');
export const MARKETING_ADS_DIR = path.join(UPLOADS_ROOT, 'marketing-ads');

/**
 * Private files live outside the public uploads tree so a static-file or nginx
 * misconfiguration can never expose them. They are served only via authenticated routes.
 */
export const PRIVATE_STORAGE_ROOT = path.resolve(
  process.env.PRIVATE_STORAGE_DIR || path.join(__dirname, '../../private')
);
export const KNOWLEDGE_DOCUMENTS_DIR = path.join(PRIVATE_STORAGE_ROOT, 'knowledge-documents');
const LEGACY_KNOWLEDGE_DOCUMENTS_DIR = path.join(UPLOADS_ROOT, 'knowledge-documents');

function migrateLegacyKnowledgeDocuments() {
  if (!fs.existsSync(LEGACY_KNOWLEDGE_DOCUMENTS_DIR)) return;
  for (const name of fs.readdirSync(LEGACY_KNOWLEDGE_DOCUMENTS_DIR)) {
    const from = path.join(LEGACY_KNOWLEDGE_DOCUMENTS_DIR, name);
    const to = path.join(KNOWLEDGE_DOCUMENTS_DIR, name);
    try {
      if (!fs.statSync(from).isFile() || fs.existsSync(to)) continue;
      try {
        fs.renameSync(from, to);
      } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
      }
    } catch (err) {
      console.error(`[Uploads] Could not move knowledge document ${name}:`, err.message);
    }
  }
  try {
    if (!fs.readdirSync(LEGACY_KNOWLEDGE_DOCUMENTS_DIR).length) {
      fs.rmdirSync(LEGACY_KNOWLEDGE_DOCUMENTS_DIR);
    }
  } catch {
    // Leave the legacy directory if it cannot be removed.
  }
}

export function ensureUploadDirs() {
  fs.mkdirSync(MARKETING_ADS_DIR, { recursive: true });
  fs.mkdirSync(KNOWLEDGE_DOCUMENTS_DIR, { recursive: true, mode: 0o750 });
  migrateLegacyKnowledgeDocuments();
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
