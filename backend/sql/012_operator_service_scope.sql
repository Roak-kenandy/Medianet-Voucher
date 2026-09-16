-- Operator service scope: Mobile only, TV only, or both

SET @col_service_scope_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'service_scope'
);

SET @add_service_scope := IF(
  @col_service_scope_exists = 0,
  "ALTER TABLE operators ADD COLUMN service_scope ENUM('OTT', 'MEDIANET_TV', 'BOTH') NOT NULL DEFAULT 'BOTH' AFTER package_type",
  'SELECT 1'
);

PREPARE stmt_add_service_scope FROM @add_service_scope;
EXECUTE stmt_add_service_scope;
DEALLOCATE PREPARE stmt_add_service_scope;
