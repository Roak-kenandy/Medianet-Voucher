-- OTT + Medianet TV service tags on packages and voucher accounts

SET @col_pkg_service_tag_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'packages'
    AND COLUMN_NAME = 'service_tag'
);

SET @add_pkg_service_tag := IF(
  @col_pkg_service_tag_exists = 0,
  "ALTER TABLE packages ADD COLUMN service_tag ENUM('OTT', 'MEDIANET_TV') NOT NULL DEFAULT 'OTT' AFTER name",
  'SELECT 1'
);

PREPARE stmt_add_pkg_service_tag FROM @add_pkg_service_tag;
EXECUTE stmt_add_pkg_service_tag;
DEALLOCATE PREPARE stmt_add_pkg_service_tag;

SET @col_va_service_tag_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'voucher_accounts'
    AND COLUMN_NAME = 'service_tag'
);

SET @add_va_service_tag := IF(
  @col_va_service_tag_exists = 0,
  "ALTER TABLE voucher_accounts ADD COLUMN service_tag ENUM('OTT', 'MEDIANET_TV') NULL AFTER phone_number",
  'SELECT 1'
);

PREPARE stmt_add_va_service_tag FROM @add_va_service_tag;
EXECUTE stmt_add_va_service_tag;
DEALLOCATE PREPARE stmt_add_va_service_tag;

ALTER TABLE voucher_accounts
  MODIFY COLUMN status ENUM('registered', 'pending', 'processing', 'created', 'failed')
  NOT NULL DEFAULT 'registered';
