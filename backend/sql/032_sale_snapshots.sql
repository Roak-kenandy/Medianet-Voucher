-- Keep what was sold as it was at the time of sale. Each package on an account records its
-- name, list price, CRM product and price term, sales model and customer type, so later edits
-- to a package never change existing accounts, reports or finance figures. The text columns
-- use the same collation as packages so the two can be compared and combined in reports.

SET @col_vap_snapshot_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'voucher_account_packages'
    AND COLUMN_NAME = 'package_name'
);

SET @add_vap_snapshot := IF(
  @col_vap_snapshot_exists = 0,
  'ALTER TABLE voucher_account_packages ADD COLUMN package_name VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL, ADD COLUMN price_amount DECIMAL(12, 2) NULL, ADD COLUMN currency_code VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL, ADD COLUMN product_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL, ADD COLUMN price_term_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL, ADD COLUMN sales_model_name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL, ADD COLUMN service_tag VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL',
  'SELECT 1'
);

PREPARE stmt_add_vap_snapshot FROM @add_vap_snapshot;
EXECUTE stmt_add_vap_snapshot;
DEALLOCATE PREPARE stmt_add_vap_snapshot;

-- Existing rows: the current package values are the best record available.
UPDATE voucher_account_packages vap
JOIN packages p ON p.id = vap.package_id
LEFT JOIN sales_models sm ON sm.id = p.sales_model_id
SET vap.package_name = p.name,
    vap.price_amount = p.price_amount,
    vap.currency_code = p.currency_code,
    vap.product_id = p.product_id,
    vap.price_term_id = p.price_term_id,
    vap.sales_model_name = sm.name,
    vap.service_tag = p.service_tag
WHERE vap.package_name IS NULL;
