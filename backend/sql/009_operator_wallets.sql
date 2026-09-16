-- Partner wallet: balance, transactions, and per-account charges

SET @col_wallet_balance_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'wallet_balance'
);

SET @add_wallet_balance := IF(
  @col_wallet_balance_exists = 0,
  'ALTER TABLE operators ADD COLUMN wallet_balance DECIMAL(12, 2) NOT NULL DEFAULT 0 AFTER accounts_created',
  'SELECT 1'
);

PREPARE stmt_add_wallet_balance FROM @add_wallet_balance;
EXECUTE stmt_add_wallet_balance;
DEALLOCATE PREPARE stmt_add_wallet_balance;

SET @col_amount_charged_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'voucher_accounts'
    AND COLUMN_NAME = 'amount_charged'
);

SET @add_amount_charged := IF(
  @col_amount_charged_exists = 0,
  'ALTER TABLE voucher_accounts ADD COLUMN amount_charged DECIMAL(12, 2) NULL AFTER package_id',
  'SELECT 1'
);

PREPARE stmt_add_amount_charged FROM @add_amount_charged;
EXECUTE stmt_add_amount_charged;
DEALLOCATE PREPARE stmt_add_amount_charged;

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  operator_id        INT UNSIGNED NOT NULL,
  type               ENUM('topup', 'debit', 'adjustment', 'refund') NOT NULL,
  status             ENUM('pending', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  amount             DECIMAL(12, 2) NOT NULL,
  commission_amount  DECIMAL(12, 2) NOT NULL DEFAULT 0,
  net_amount         DECIMAL(12, 2) NOT NULL,
  balance_before     DECIMAL(12, 2) NOT NULL,
  balance_after      DECIMAL(12, 2) NOT NULL,
  currency_code      VARCHAR(10) NOT NULL DEFAULT 'MVR',
  reference          VARCHAR(64) NOT NULL,
  payment_ref        VARCHAR(255) NULL,
  voucher_account_id INT UNSIGNED NULL,
  description        VARCHAR(500) NULL,
  metadata           JSON NULL,
  created_by_type    ENUM('admin', 'operator', 'system') NULL,
  created_by_id      INT UNSIGNED NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at       DATETIME NULL,
  UNIQUE KEY uk_wallet_transactions_reference (reference),
  CONSTRAINT fk_wallet_transactions_operator FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE RESTRICT,
  CONSTRAINT fk_wallet_transactions_voucher FOREIGN KEY (voucher_account_id) REFERENCES voucher_accounts(id) ON DELETE SET NULL,
  INDEX idx_wallet_transactions_operator (operator_id, created_at),
  INDEX idx_wallet_transactions_status (status),
  INDEX idx_wallet_transactions_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
