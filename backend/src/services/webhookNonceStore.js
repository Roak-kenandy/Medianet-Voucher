const NONCE_TTL_MS = 10 * 60 * 1000;
const seenNonces = new Map();

function pruneExpired(now = Date.now()) {
  for (const [nonce, expiresAt] of seenNonces) {
    if (expiresAt <= now) {
      seenNonces.delete(nonce);
    }
  }
}

/**
 * Returns false if nonce was already used (replay). Stores nonce on first use.
 */
export function consumeWebhookNonce(nonce) {
  if (!nonce || typeof nonce !== 'string') return false;

  pruneExpired();

  if (seenNonces.has(nonce)) {
    return false;
  }

  seenNonces.set(nonce, Date.now() + NONCE_TTL_MS);
  return true;
}
