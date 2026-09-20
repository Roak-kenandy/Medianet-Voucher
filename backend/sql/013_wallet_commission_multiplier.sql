-- Replace fixed/percent commission with multiplier on payment total.
-- Must expand ENUM before writing 'multiplier', then shrink after data migration.

SET @enum_has_legacy := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND COLUMN_NAME = 'wallet_commission_type'
    AND (
      COLUMN_TYPE LIKE '%fixed%'
      OR COLUMN_TYPE LIKE '%percent%'
    )
);

SET @expand_enum := IF(
  @enum_has_legacy > 0,
  "ALTER TABLE operators MODIFY COLUMN wallet_commission_type ENUM('none', 'fixed', 'percent', 'multiplier') NOT NULL DEFAULT 'none'",
  'SELECT 1'
);

PREPARE stmt_expand_enum FROM @expand_enum;
EXECUTE stmt_expand_enum;
DEALLOCATE PREPARE stmt_expand_enum;

-- Convert percent bonus to multiplier (e.g. 15 -> 1.15)
UPDATE operators
SET
  wallet_commission_type = 'multiplier',
  wallet_commission_value = ROUND(1 + (wallet_commission_value / 100), 4)
WHERE wallet_commission_type = 'percent'
  AND wallet_commission_value > 0;

-- Remaining percent/fixed (including zero values) -> none
UPDATE operators
SET
  wallet_commission_type = 'none',
  wallet_commission_value = 1
WHERE wallet_commission_type IN ('percent', 'fixed');

SET @shrink_enum := IF(
  @enum_has_legacy > 0,
  "ALTER TABLE operators MODIFY COLUMN wallet_commission_type ENUM('none', 'multiplier') NOT NULL DEFAULT 'none'",
  'SELECT 1'
);

PREPARE stmt_shrink_enum FROM @shrink_enum;
EXECUTE stmt_shrink_enum;
DEALLOCATE PREPARE stmt_shrink_enum;
