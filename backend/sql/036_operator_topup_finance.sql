-- Commission ratio needs more than 2 decimal places (for example 1.86207).

ALTER TABLE operators
  MODIFY COLUMN wallet_commission_value DECIMAL(12, 5) NOT NULL DEFAULT 0;
