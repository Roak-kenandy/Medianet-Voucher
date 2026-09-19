SET @col_trial_expires_at_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'trial_expires_at'
);

SET @add_trial_expires_at := IF(
  @col_trial_expires_at_exists = 0,
  'ALTER TABLE operators ADD COLUMN trial_expires_at DATETIME NULL AFTER wallet_commission_value',
  'SELECT 1'
);

PREPARE stmt_add_trial_expires_at FROM @add_trial_expires_at;
EXECUTE stmt_add_trial_expires_at;
DEALLOCATE PREPARE stmt_add_trial_expires_at;
