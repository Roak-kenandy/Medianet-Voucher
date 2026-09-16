import { AppError } from './errors.js';

/**
 * Log full upstream error details server-side; return a safe message to clients.
 */
export function throwSafeExternalError({
  logPrefix,
  context,
  status,
  clientMessage,
  code = 'EXTERNAL_SERVICE_ERROR',
  detail = '',
}) {
  if (detail) {
    console.error(`[${logPrefix}] ${context} failed (${status}):`, detail.slice(0, 500));
  } else {
    console.error(`[${logPrefix}] ${context} failed (${status})`);
  }

  throw new AppError(clientMessage, status >= 500 ? 502 : 400, code);
}
