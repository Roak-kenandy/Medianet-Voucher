SET @col_trial_account_limit_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'trial_account_limit'
);

SET @add_trial_account_limit := IF(
  @col_trial_account_limit_exists = 0,
  'ALTER TABLE operators ADD COLUMN trial_account_limit INT NOT NULL DEFAULT 0 AFTER trial_expires_at',
  'SELECT 1'
);

PREPARE stmt_add_trial_account_limit FROM @add_trial_account_limit;
EXECUTE stmt_add_trial_account_limit;
DEALLOCATE PREPARE stmt_add_trial_account_limit;

SET @col_trial_accounts_used_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'trial_accounts_used'
);

SET @add_trial_accounts_used := IF(
  @col_trial_accounts_used_exists = 0,
  'ALTER TABLE operators ADD COLUMN trial_accounts_used INT NOT NULL DEFAULT 0 AFTER trial_account_limit',
  'SELECT 1'
);

PREPARE stmt_add_trial_accounts_used FROM @add_trial_accounts_used;
EXECUTE stmt_add_trial_accounts_used;
DEALLOCATE PREPARE stmt_add_trial_accounts_used;
