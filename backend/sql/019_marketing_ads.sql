CREATE TABLE IF NOT EXISTS marketing_ads (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title               VARCHAR(200) NOT NULL,
  description         TEXT NULL,
  image_filename      VARCHAR(255) NOT NULL,
  link_url            VARCHAR(500) NULL,
  display_start       DATETIME NOT NULL,
  display_end         DATETIME NULL,
  sort_order          INT NOT NULL DEFAULT 0,
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  created_by_admin_id INT UNSIGNED NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_marketing_ads_schedule (is_active, display_start, display_end),
  CONSTRAINT fk_marketing_ads_admin FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
