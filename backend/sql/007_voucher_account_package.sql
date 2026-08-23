-- Store which package was provisioned for each voucher account

SET @col_va_package_id_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'voucher_accounts'
    AND COLUMN_NAME = 'package_id'
);

SET @add_va_package_id := IF(
  @col_va_package_id_exists = 0,
  'ALTER TABLE voucher_accounts ADD COLUMN package_id INT UNSIGNED NULL AFTER operator_id',
  'SELECT 1'
);

PREPARE stmt_add_va_package_id FROM @add_va_package_id;
EXECUTE stmt_add_va_package_id;
DEALLOCATE PREPARE stmt_add_va_package_id;

SET @fk_va_package_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'voucher_accounts'
    AND CONSTRAINT_NAME = 'fk_voucher_accounts_package'
);

SET @add_fk_va_package := IF(
  @fk_va_package_exists = 0,
  'ALTER TABLE voucher_accounts ADD CONSTRAINT fk_voucher_accounts_package FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt_fk_va_package FROM @add_fk_va_package;
EXECUTE stmt_fk_va_package;
DEALLOCATE PREPARE stmt_fk_va_package;
