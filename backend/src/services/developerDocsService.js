import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppError } from '../utils/errors.js';
import { getOperatorApiAccess } from './operatorApiKeyService.js';

const DOCS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs');

/** The guide points at a file next to it in the repository; the portal page has no such file. */
function withoutFileLinks(guide) {
  return guide.replace(/\nA machine-readable description is in[^\n]*\n/, '\n');
}

/**
 * The Operator API guide. It is kept out of every public directory and only ever served
 * through the signed-in routes that call this.
 */
export async function getDeveloperDocs() {
  try {
    const guide = await fs.readFile(path.join(DOCS_DIR, 'partner-api.md'), 'utf8');
    return { guide: withoutFileLinks(guide) };
  } catch (err) {
    console.error('[Developer docs] Could not read documentation files:', err.message);
    throw new AppError('The developer documentation is not available', 503, 'DOCS_UNAVAILABLE');
  }
}

/** Operators see the documentation only while Medianet has API access turned on for them. */
export async function getDeveloperDocsForOperator(operatorId) {
  if (!(await getOperatorApiAccess(operatorId))) {
    throw new AppError(
      'API access is not enabled for your account. Contact Medianet to request it.',
      403,
      'API_ACCESS_DISABLED'
    );
  }
  return getDeveloperDocs();
}
