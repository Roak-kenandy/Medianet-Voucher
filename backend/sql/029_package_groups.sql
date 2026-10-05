-- Package groups: a named set of packages shared by several operators. An operator sells
-- its individually assigned packages plus the packages of every group it belongs to, so
-- changing a group changes all of its operators at once. Existing assignments are untouched.

CREATE TABLE IF NOT EXISTS package_groups (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(120) NOT NULL,
  description         VARCHAR(500) NULL,
  created_by_admin_id INT UNSIGNED NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_package_groups_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS package_group_items (
  group_id   INT UNSIGNED NOT NULL,
  package_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, package_id),
  CONSTRAINT fk_package_group_items_group FOREIGN KEY (group_id) REFERENCES package_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_package_group_items_package FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE RESTRICT,
  INDEX idx_package_group_items_package (package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operator_package_groups (
  operator_id INT UNSIGNED NOT NULL,
  group_id    INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (operator_id, group_id),
  CONSTRAINT fk_operator_package_groups_operator FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
  CONSTRAINT fk_operator_package_groups_group FOREIGN KEY (group_id) REFERENCES package_groups(id) ON DELETE RESTRICT,
  INDEX idx_operator_package_groups_group (group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
