-- Webhook replay protection shared across restarts and multiple API processes.
CREATE TABLE IF NOT EXISTS webhook_nonces (
  nonce VARCHAR(128) NOT NULL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_webhook_nonces_created (created_at)
);
