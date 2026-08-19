-- Packages catalog (CRM-linked) and operator notes

CREATE TABLE IF NOT EXISTS packages (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(200) NOT NULL,
  sku                 VARCHAR(100) NULL,
  product_id          CHAR(36) NOT NULL,
  price_term_id       CHAR(36) NOT NULL,
  price_amount        DECIMAL(10, 2) NOT NULL DEFAULT 0,
  currency_code       VARCHAR(10) NOT NULL DEFAULT 'MVR',
  description         TEXT NULL,
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  created_by_admin_id INT UNSIGNED NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_packages_product_price (product_id, price_term_id),
  INDEX idx_packages_active (is_active),
  CONSTRAINT fk_packages_admin FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS package_id INT UNSIGNED NULL AFTER package_type,
  ADD COLUMN IF NOT EXISTS notes TEXT NULL AFTER account_quota;

SET @fk_operators_package_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'operators'
    AND CONSTRAINT_NAME = 'fk_operators_package'
);

SET @add_fk_operators_package := IF(
  @fk_operators_package_exists = 0,
  'ALTER TABLE operators ADD CONSTRAINT fk_operators_package FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE RESTRICT',
  'SELECT 1'
);

PREPARE stmt_fk_operators_package FROM @add_fk_operators_package;
EXECUTE stmt_fk_operators_package;
DEALLOCATE PREPARE stmt_fk_operators_package;

-- Seed default OTT package (matches legacy static catalog)
INSERT INTO packages (name, sku, product_id, price_term_id, price_amount, currency_code, description, is_active)
SELECT 'OTT ENTERTAINMENT (1y)', NULL, '4bda88eb-05f0-4ac5-b68e-415c0c784b56', '605e6004-505e-4aa2-ab1e-e57bf9c79b14', 599, 'MVR', 'Legacy default package', 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM packages WHERE product_id = '4bda88eb-05f0-4ac5-b68e-415c0c784b56'
    AND price_term_id = '605e6004-505e-4aa2-ab1e-e57bf9c79b14'
);

UPDATE operators o
JOIN packages p ON p.name = o.package_type
SET o.package_id = p.id
WHERE o.package_id IS NULL;

UPDATE operators o
JOIN packages p ON p.name = 'OTT ENTERTAINMENT (1y)'
SET o.package_id = p.id
WHERE o.package_id IS NULL;
