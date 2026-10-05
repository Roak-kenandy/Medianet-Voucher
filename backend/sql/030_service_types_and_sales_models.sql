-- Customer (service) types and CRM sales models become admin-managed lists instead of two
-- hardcoded types and one global sales model. Operators get an allow-list for each, and every
-- package records the sales model its price belongs to. Mobile (OTT) and Medianet TV are
-- seeded as the first two types, so existing data keeps its meaning.

CREATE TABLE IF NOT EXISTS service_types (
  id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type_key                VARCHAR(40) NOT NULL,
  label                   VARCHAR(120) NOT NULL,
  short_label             VARCHAR(40) NOT NULL,
  crm_tag_id              VARCHAR(64) NULL,
  crm_tag_name            VARCHAR(120) NOT NULL,
  crm_device_product_id   VARCHAR(64) NULL,
  crm_price_segment_name  VARCHAR(120) NULL,
  is_active               TINYINT(1) NOT NULL DEFAULT 1,
  sort_order              INT NOT NULL DEFAULT 0,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_service_types_key (type_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CRM ids stay NULL here and fall back to the .env values until staff set them in the portal.
INSERT IGNORE INTO service_types (type_key, label, short_label, crm_tag_name, crm_price_segment_name, sort_order)
VALUES
  ('OTT', 'Mobile (OTT)', 'Mobile', 'OTT', 'OTT', 1),
  ('MEDIANET_TV', 'TV (Medianet TV)', 'TV', 'Medianet TV', NULL, 2);

ALTER TABLE packages MODIFY COLUMN service_tag VARCHAR(40) NOT NULL DEFAULT 'OTT';
ALTER TABLE voucher_accounts MODIFY COLUMN service_tag VARCHAR(40) NULL;

CREATE TABLE IF NOT EXISTS operator_service_types (
  operator_id      INT UNSIGNED NOT NULL,
  service_type_key VARCHAR(40) NOT NULL,
  is_default       TINYINT(1) NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (operator_id, service_type_key),
  CONSTRAINT fk_operator_service_types_operator FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
  INDEX idx_operator_service_types_key (service_type_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO operator_service_types (operator_id, service_type_key, is_default)
SELECT o.id, 'OTT', 1 FROM operators o WHERE o.service_scope IN ('OTT', 'BOTH');

INSERT IGNORE INTO operator_service_types (operator_id, service_type_key, is_default)
SELECT o.id, 'MEDIANET_TV', IF(o.service_scope = 'MEDIANET_TV', 1, 0)
FROM operators o WHERE o.service_scope IN ('MEDIANET_TV', 'BOTH');

CREATE TABLE IF NOT EXISTS sales_models (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sales_models_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @col_package_sales_model_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'packages'
    AND COLUMN_NAME = 'sales_model_id'
);

SET @add_package_sales_model := IF(
  @col_package_sales_model_exists = 0,
  'ALTER TABLE packages ADD COLUMN sales_model_id INT UNSIGNED NULL AFTER service_tag, ADD INDEX idx_packages_sales_model (sales_model_id)',
  'SELECT 1'
);

PREPARE stmt_add_package_sales_model FROM @add_package_sales_model;
EXECUTE stmt_add_package_sales_model;
DEALLOCATE PREPARE stmt_add_package_sales_model;

CREATE TABLE IF NOT EXISTS operator_sales_models (
  operator_id    INT UNSIGNED NOT NULL,
  sales_model_id INT UNSIGNED NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (operator_id, sales_model_id),
  CONSTRAINT fk_operator_sales_models_operator FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
  CONSTRAINT fk_operator_sales_models_model FOREIGN KEY (sales_model_id) REFERENCES sales_models(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
