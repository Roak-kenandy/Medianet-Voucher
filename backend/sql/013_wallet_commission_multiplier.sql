-- Replace fixed/percent commission with multiplier on post-GST amount

UPDATE operators
SET
  wallet_commission_type = 'multiplier',
  wallet_commission_value = ROUND(1 + (wallet_commission_value / 100), 4)
WHERE wallet_commission_type = 'percent'
  AND wallet_commission_value > 0;

UPDATE operators
SET
  wallet_commission_type = 'none',
  wallet_commission_value = 1
WHERE wallet_commission_type = 'fixed';

ALTER TABLE operators
  MODIFY COLUMN wallet_commission_type ENUM('none', 'multiplier') NOT NULL DEFAULT 'none';
