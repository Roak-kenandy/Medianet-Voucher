-- Partner API: one row per Idempotency-Key, so a retried money request is answered from the
-- stored result instead of charging the operator wallet a second time.
CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  operator_id     INT UNSIGNED NOT NULL,
  api_key_id      INT UNSIGNED NULL,
  idempotency_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  endpoint        VARCHAR(60) NOT NULL,
  request_hash    CHAR(64) NOT NULL,
  status          ENUM('processing', 'completed') NOT NULL DEFAULT 'processing',
  response_status SMALLINT UNSIGNED NULL,
  response_body   JSON NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME NULL,
  UNIQUE KEY uk_api_idempotency (operator_id, idempotency_key),
  INDEX idx_api_idempotency_created (created_at),
  CONSTRAINT fk_api_idempotency_operator FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
