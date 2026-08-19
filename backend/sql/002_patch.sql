-- Patch 002: operator package field

SET @col_package_type_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'package_type'
);

SET @add_package_type := IF(
  @col_package_type_exists = 0,
  'ALTER TABLE operators ADD COLUMN package_type VARCHAR(100) NOT NULL DEFAULT ''OTT'' AFTER client_name',
  'SELECT 1'
);

PREPARE stmt_add_package_type FROM @add_package_type;
EXECUTE stmt_add_package_type;
DEALLOCATE PREPARE stmt_add_package_type;
