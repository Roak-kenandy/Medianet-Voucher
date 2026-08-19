-- Operator ↔ packages (many-to-many)

CREATE TABLE IF NOT EXISTS operator_packages (
  operator_id INT UNSIGNED NOT NULL,
  package_id  INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (operator_id, package_id),
  CONSTRAINT fk_operator_packages_operator FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE,
  CONSTRAINT fk_operator_packages_package FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE RESTRICT,
  INDEX idx_operator_packages_package (package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO operator_packages (operator_id, package_id)
SELECT id, package_id FROM operators WHERE package_id IS NOT NULL;
