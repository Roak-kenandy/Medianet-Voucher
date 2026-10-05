-- Bind refresh tokens to the credentials version and login session they were issued under,
-- and give the failed-login counter a rolling window so it decays instead of accumulating.

SET @col_rt_cred_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refresh_tokens'
    AND COLUMN_NAME = 'credentials_version'
);

SET @add_rt_cred := IF(
  @col_rt_cred_exists = 0,
  'ALTER TABLE refresh_tokens ADD COLUMN credentials_version INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);

PREPARE stmt_add_rt_cred FROM @add_rt_cred;
EXECUTE stmt_add_rt_cred;
DEALLOCATE PREPARE stmt_add_rt_cred;

SET @col_rt_family_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refresh_tokens'
    AND COLUMN_NAME = 'family_id'
);

SET @add_rt_family := IF(
  @col_rt_family_exists = 0,
  'ALTER TABLE refresh_tokens ADD COLUMN family_id CHAR(32) NULL, ADD INDEX idx_refresh_tokens_family (family_id)',
  'SELECT 1'
);

PREPARE stmt_add_rt_family FROM @add_rt_family;
EXECUTE stmt_add_rt_family;
DEALLOCATE PREPARE stmt_add_rt_family;

-- Live sessions keep working: stamp them with the owner's current credentials version.
UPDATE refresh_tokens rt
JOIN operators o ON rt.user_type = 'operator' AND o.id = rt.user_id
SET rt.credentials_version = o.credentials_version
WHERE rt.revoked_at IS NULL;

UPDATE refresh_tokens rt
JOIN admins a ON rt.user_type = 'admin' AND a.id = rt.user_id
SET rt.credentials_version = a.credentials_version
WHERE rt.revoked_at IS NULL;

-- Each live pre-migration token becomes its own session family.
UPDATE refresh_tokens
SET family_id = MD5(CONCAT('legacy-', id))
WHERE family_id IS NULL AND revoked_at IS NULL;

-- Tokens rotated before this migration have no family, so they can no longer trigger reuse detection.
UPDATE refresh_tokens
SET revoked_reason = 'superseded'
WHERE revoked_reason = 'rotated' AND family_id IS NULL;

SET @col_admin_window_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admins'
    AND COLUMN_NAME = 'failed_login_window_start'
);

SET @add_admin_window := IF(
  @col_admin_window_exists = 0,
  'ALTER TABLE admins ADD COLUMN failed_login_window_start DATETIME NULL AFTER failed_login_attempts',
  'SELECT 1'
);

PREPARE stmt_add_admin_window FROM @add_admin_window;
EXECUTE stmt_add_admin_window;
DEALLOCATE PREPARE stmt_add_admin_window;

SET @col_operator_window_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'failed_login_window_start'
);

SET @add_operator_window := IF(
  @col_operator_window_exists = 0,
  'ALTER TABLE operators ADD COLUMN failed_login_window_start DATETIME NULL AFTER failed_login_attempts',
  'SELECT 1'
);

PREPARE stmt_add_operator_window FROM @add_operator_window;
EXECUTE stmt_add_operator_window;
DEALLOCATE PREPARE stmt_add_operator_window;

-- Counters left at the old threshold without a lock timestamp could never reset.
UPDATE admins SET failed_login_attempts = 0 WHERE locked_until IS NULL AND failed_login_attempts > 0;
UPDATE operators SET failed_login_attempts = 0 WHERE locked_until IS NULL AND failed_login_attempts > 0;
