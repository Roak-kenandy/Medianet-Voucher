import { query } from '../db/pool.js';

const NONCE_RETENTION_MINUTES = 60;
const PURGE_INTERVAL_MS = 10 * 60 * 1000;
let lastPurgeAt = 0;

async function purgeExpiredNonces() {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  try {
    await query(
      `DELETE FROM webhook_nonces WHERE created_at < NOW() - INTERVAL ${NONCE_RETENTION_MINUTES} MINUTE`
    );
  } catch (err) {
    console.error('[Webhook] Nonce purge failed:', err.message);
  }
}

/**
 * Returns false if the nonce was already used (replay). Stored in MySQL so replay protection
 * survives restarts and is shared by every API process.
 */
export async function consumeWebhookNonce(nonce) {
  if (!nonce || typeof nonce !== 'string' || nonce.length > 128) return false;

  await purgeExpiredNonces();

  try {
    await query('INSERT INTO webhook_nonces (nonce) VALUES (?)', [nonce]);
    return true;
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') return false;
    throw err;
  }
}
