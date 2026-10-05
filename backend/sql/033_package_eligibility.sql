-- Package eligibility rules. A package is a base plan (member of an upgrade family, ordered
-- by tier), an add-on (needs one of its required base packages), or standalone (always
-- sellable). Existing packages become standalone, which is how they behaved before.

SET @col_package_role_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'packages'
    AND COLUMN_NAME = 'package_role'
);

SET @add_package_role := IF(
  @col_package_role_exists = 0,
  "ALTER TABLE packages ADD COLUMN package_role ENUM('base', 'addon', 'standalone') NOT NULL DEFAULT 'standalone' AFTER sales_model_id, ADD COLUMN upgrade_family VARCHAR(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER package_role, ADD COLUMN upgrade_tier INT NULL AFTER upgrade_family",
  'SELECT 1'
);

PREPARE stmt_add_package_role FROM @add_package_role;
EXECUTE stmt_add_package_role;
DEALLOCATE PREPARE stmt_add_package_role;

-- An add-on can be sold when the customer has ANY ONE of its required packages.
CREATE TABLE IF NOT EXISTS package_requirements (
  package_id          INT UNSIGNED NOT NULL,
  required_package_id INT UNSIGNED NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (package_id, required_package_id),
  CONSTRAINT fk_package_requirements_package FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE,
  CONSTRAINT fk_package_requirements_required FOREIGN KEY (required_package_id) REFERENCES packages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
