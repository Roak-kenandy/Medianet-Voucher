-- Per-operator switch for the Operator API: who may use API keys and see the developer
-- documentation in the portal. Operators that already hold an active key keep working.
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operators' AND COLUMN_NAME = 'api_access_enabled'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE operators ADD COLUMN api_access_enabled TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE operators o
SET o.api_access_enabled = 1
WHERE @col_exists = 0
  AND EXISTS (SELECT 1 FROM operator_api_keys k WHERE k.operator_id = o.id AND k.revoked_at IS NULL);
