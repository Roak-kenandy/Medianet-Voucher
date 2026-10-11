-- Finance revenue-share ratios are kept to 14 decimal places (for example 108 / 58 = 1.86206896551724).

ALTER TABLE operators
  MODIFY COLUMN wallet_commission_value DECIMAL(20, 14) NOT NULL DEFAULT 0;
