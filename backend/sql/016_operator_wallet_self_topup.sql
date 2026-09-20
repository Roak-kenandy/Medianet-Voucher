-- Allow staff to disable operator self-service wallet top-up (BML). Staff top-up still works.

SET @col_wallet_self_topup_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'wallet_self_topup_enabled'
);

SET @add_wallet_self_topup := IF(
  @col_wallet_self_topup_exists = 0,
  'ALTER TABLE operators ADD COLUMN wallet_self_topup_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER wallet_commission_value',
  'SELECT 1'
);

PREPARE stmt_add_wallet_self_topup FROM @add_wallet_self_topup;
EXECUTE stmt_add_wallet_self_topup;
DEALLOCATE PREPARE stmt_add_wallet_self_topup;
