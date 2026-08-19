-- Staff roles on admin portal users: admin (full), sales, finance

SET @col_admin_role_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admins'
    AND COLUMN_NAME = 'role'
);

SET @add_admin_role := IF(
  @col_admin_role_exists = 0,
  'ALTER TABLE admins ADD COLUMN role ENUM(''admin'', ''sales'', ''finance'') NOT NULL DEFAULT ''admin'' AFTER email',
  'SELECT 1'
);

PREPARE stmt_add_admin_role FROM @add_admin_role;
EXECUTE stmt_add_admin_role;
DEALLOCATE PREPARE stmt_add_admin_role;

UPDATE admins SET role = 'admin' WHERE role IS NULL OR role = '';
