-- Wallet top-up commission can be entered as a percentage as well as a multiplier (ratio),
-- and staff can issue API keys for the upcoming operator API.

SET @commission_enum_has_percent := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'wallet_commission_type'
    AND COLUMN_TYPE LIKE '%percent%'
);

SET @add_commission_percent := IF(
  @commission_enum_has_percent = 0,
  "ALTER TABLE operators MODIFY COLUMN wallet_commission_type ENUM('none', 'multiplier', 'percent') NOT NULL DEFAULT 'none'",
  'SELECT 1'
);

PREPARE stmt_add_commission_percent FROM @add_commission_percent;
EXECUTE stmt_add_commission_percent;
DEALLOCATE PREPARE stmt_add_commission_percent;

-- Only a SHA-256 hash of each key is stored. The key itself is shown once, when it is created.
CREATE TABLE IF NOT EXISTS operator_api_keys (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  operator_id         INT UNSIGNED NOT NULL,
  name                VARCHAR(120) NOT NULL,
  key_prefix          VARCHAR(16) NOT NULL,
  key_hash            CHAR(64) NOT NULL,
  created_by_admin_id INT UNSIGNED NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at        DATETIME NULL,
  revoked_at          DATETIME NULL,
  revoked_by_admin_id INT UNSIGNED NULL,
  UNIQUE KEY uk_operator_api_keys_hash (key_hash),
  INDEX idx_operator_api_keys_operator (operator_id, revoked_at),
  CONSTRAINT fk_operator_api_keys_operator FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
