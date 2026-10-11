-- CRM payment types become an admin-managed list, and each operator can be given one. The CRM
-- payments posted for that operator's sales then carry its payment type. Operators without one
-- keep using the PAYMENT_TYPE_ID from .env.

CREATE TABLE IF NOT EXISTS payment_types (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  crm_type_id VARCHAR(64) NOT NULL,
  description VARCHAR(500) NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_payment_types_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operators' AND COLUMN_NAME = 'payment_type_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE operators ADD COLUMN payment_type_id INT UNSIGNED NULL, ADD CONSTRAINT fk_operators_payment_type FOREIGN KEY (payment_type_id) REFERENCES payment_types(id) ON DELETE RESTRICT',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
