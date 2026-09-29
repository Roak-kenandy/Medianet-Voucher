-- Distinguish rotated refresh tokens (reuse = possible theft) from logout / admin revocation.

SET @col_revoked_reason_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refresh_tokens'
    AND COLUMN_NAME = 'revoked_reason'
);

SET @add_revoked_reason := IF(
  @col_revoked_reason_exists = 0,
  'ALTER TABLE refresh_tokens ADD COLUMN revoked_reason VARCHAR(32) NULL AFTER revoked_at',
  'SELECT 1'
);

PREPARE stmt_add_revoked_reason FROM @add_revoked_reason;
EXECUTE stmt_add_revoked_reason;
DEALLOCATE PREPARE stmt_add_revoked_reason;

SET @idx_refresh_expires_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'refresh_tokens'
    AND INDEX_NAME = 'idx_refresh_expires'
);

SET @add_refresh_expires_idx := IF(
  @idx_refresh_expires_exists = 0,
  'ALTER TABLE refresh_tokens ADD INDEX idx_refresh_expires (expires_at)',
  'SELECT 1'
);

PREPARE stmt_add_refresh_expires_idx FROM @add_refresh_expires_idx;
EXECUTE stmt_add_refresh_expires_idx;
DEALLOCATE PREPARE stmt_add_refresh_expires_idx;

DELETE FROM refresh_tokens WHERE expires_at < NOW() - INTERVAL 1 DAY;
