-- Track how each voucher account was created (new account, bulk, subscribe)

SET @col_origin_activity_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'voucher_accounts'
    AND COLUMN_NAME = 'origin_activity'
);

SET @add_origin_activity := IF(
  @col_origin_activity_exists = 0,
  "ALTER TABLE voucher_accounts ADD COLUMN origin_activity VARCHAR(32) NULL AFTER service_tag",
  'SELECT 1'
);

PREPARE stmt_add_origin_activity FROM @add_origin_activity;
EXECUTE stmt_add_origin_activity;
DEALLOCATE PREPARE stmt_add_origin_activity;

UPDATE voucher_accounts va
INNER JOIN wallet_transactions wt
  ON wt.voucher_account_id = va.id
 AND wt.type = 'debit'
 AND wt.status = 'completed'
SET va.origin_activity = JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.activity'))
WHERE va.origin_activity IS NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(wt.metadata, '$.activity')) IS NOT NULL;

UPDATE voucher_accounts
SET origin_activity = 'create_account'
WHERE origin_activity IS NULL;
