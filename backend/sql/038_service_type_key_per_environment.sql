-- The same customer type key (for example OTT) may now exist once in live and once in sandbox,
-- so the sandbox can mirror production. A key alone no longer says which CRM a package belongs
-- to, so packages record their own environment (copied here from their customer type).

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'packages' AND COLUMN_NAME = 'environment'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE packages ADD COLUMN environment VARCHAR(20) NOT NULL DEFAULT ''live''',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Only while keys are still unique: afterwards a key can match two customer types.
SET @old_key_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_types' AND INDEX_NAME = 'uk_service_types_key'
);
SET @sql := IF(@old_key_exists > 0,
  'UPDATE packages p INNER JOIN service_types st ON st.type_key = p.service_tag SET p.environment = st.environment',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @new_key_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_types' AND INDEX_NAME = 'uk_service_types_key_environment'
);
SET @sql := IF(@new_key_exists = 0,
  'ALTER TABLE service_types ADD UNIQUE KEY uk_service_types_key_environment (type_key, environment)',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := IF(@old_key_exists > 0,
  'ALTER TABLE service_types DROP INDEX uk_service_types_key',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
