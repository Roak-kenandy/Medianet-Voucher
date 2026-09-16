-- Per-operator wallet top-up commission (bonus added to payment)

SET @col_wallet_commission_type_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'wallet_commission_type'
);

SET @add_wallet_commission_type := IF(
  @col_wallet_commission_type_exists = 0,
  "ALTER TABLE operators ADD COLUMN wallet_commission_type ENUM('none', 'fixed', 'percent') NOT NULL DEFAULT 'none' AFTER wallet_balance",
  'SELECT 1'
);

PREPARE stmt_add_wallet_commission_type FROM @add_wallet_commission_type;
EXECUTE stmt_add_wallet_commission_type;
DEALLOCATE PREPARE stmt_add_wallet_commission_type;

SET @col_wallet_commission_value_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'wallet_commission_value'
);

SET @add_wallet_commission_value := IF(
  @col_wallet_commission_value_exists = 0,
  'ALTER TABLE operators ADD COLUMN wallet_commission_value DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER wallet_commission_type',
  'SELECT 1'
);

PREPARE stmt_add_wallet_commission_value FROM @add_wallet_commission_value;
EXECUTE stmt_add_wallet_commission_value;
DEALLOCATE PREPARE stmt_add_wallet_commission_value;
