-- Sandbox operators: an operator marked `sandbox` talks to the CRM sandbox (CRM_SANDBOX_* in
-- .env) instead of the live CRM. CRM ids differ between the two, so customer types and payment
-- types belong to one environment and an operator can only be given those of its own. Packages
-- follow their customer type. Everything that exists today is live.

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operators' AND COLUMN_NAME = 'environment'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE operators ADD COLUMN environment VARCHAR(20) NOT NULL DEFAULT ''live''',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_types' AND COLUMN_NAME = 'environment'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE service_types ADD COLUMN environment VARCHAR(20) NOT NULL DEFAULT ''live''',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_types' AND COLUMN_NAME = 'environment'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE payment_types ADD COLUMN environment VARCHAR(20) NOT NULL DEFAULT ''live''',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
