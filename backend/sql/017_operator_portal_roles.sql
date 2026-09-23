-- Operator portal role: supervisor (full access) or user (configurable permissions)

SET @col_portal_role_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'portal_role'
);

SET @add_portal_role := IF(
  @col_portal_role_exists = 0,
  "ALTER TABLE operators ADD COLUMN portal_role ENUM('supervisor', 'user') NOT NULL DEFAULT 'supervisor' AFTER wallet_self_topup_enabled",
  'SELECT 1'
);

PREPARE stmt_add_portal_role FROM @add_portal_role;
EXECUTE stmt_add_portal_role;
DEALLOCATE PREPARE stmt_add_portal_role;

SET @col_portal_permissions_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'portal_permissions'
);

SET @add_portal_permissions := IF(
  @col_portal_permissions_exists = 0,
  'ALTER TABLE operators ADD COLUMN portal_permissions JSON NULL AFTER portal_role',
  'SELECT 1'
);

PREPARE stmt_add_portal_permissions FROM @add_portal_permissions;
EXECUTE stmt_add_portal_permissions;
DEALLOCATE PREPARE stmt_add_portal_permissions;
