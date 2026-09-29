-- Bumped whenever a password or login email changes so existing access tokens stop working.

SET @col_admin_cred_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admins'
    AND COLUMN_NAME = 'credentials_version'
);

SET @add_admin_cred := IF(
  @col_admin_cred_exists = 0,
  'ALTER TABLE admins ADD COLUMN credentials_version INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);

PREPARE stmt_add_admin_cred FROM @add_admin_cred;
EXECUTE stmt_add_admin_cred;
DEALLOCATE PREPARE stmt_add_admin_cred;

SET @col_operator_cred_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'credentials_version'
);

SET @add_operator_cred := IF(
  @col_operator_cred_exists = 0,
  'ALTER TABLE operators ADD COLUMN credentials_version INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);

PREPARE stmt_add_operator_cred FROM @add_operator_cred;
EXECUTE stmt_add_operator_cred;
DEALLOCATE PREPARE stmt_add_operator_cred;
