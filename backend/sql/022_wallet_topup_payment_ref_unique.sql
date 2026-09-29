-- One BML payment can credit at most one wallet row.
-- If duplicates already exist the migration stops with an error naming the problem
-- so they can be reviewed manually before the index is added.

SET @dup_payment_refs := (
  SELECT COUNT(*) FROM (
    SELECT payment_ref
    FROM wallet_transactions
    WHERE payment_ref IS NOT NULL AND payment_ref <> ''
    GROUP BY payment_ref
    HAVING COUNT(*) > 1
  ) d
);

SET @guard_payment_refs := IF(
  @dup_payment_refs = 0,
  'SELECT 1',
  'SELECT duplicate_wallet_payment_refs_must_be_resolved_before_migration_022 FROM DUAL'
);

PREPARE stmt_guard_payment_refs FROM @guard_payment_refs;
EXECUTE stmt_guard_payment_refs;
DEALLOCATE PREPARE stmt_guard_payment_refs;

UPDATE wallet_transactions SET payment_ref = NULL WHERE payment_ref = '';

SET @idx_payment_ref_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wallet_transactions'
    AND INDEX_NAME = 'uq_wallet_payment_ref'
);

SET @add_payment_ref_idx := IF(
  @idx_payment_ref_exists = 0,
  'ALTER TABLE wallet_transactions ADD UNIQUE INDEX uq_wallet_payment_ref (payment_ref)',
  'SELECT 1'
);

PREPARE stmt_add_payment_ref_idx FROM @add_payment_ref_idx;
EXECUTE stmt_add_payment_ref_idx;
DEALLOCATE PREPARE stmt_add_payment_ref_idx;
