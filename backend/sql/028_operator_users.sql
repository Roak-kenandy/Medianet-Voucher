-- Several portal users per operator. Each existing operator login becomes that operator's
-- first user and keeps the same id, so its current sessions and audit history stay valid.

CREATE TABLE IF NOT EXISTS operator_users (
  id                        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  operator_id               INT UNSIGNED NOT NULL,
  name                      VARCHAR(200) NOT NULL,
  email                     VARCHAR(255) NOT NULL,
  password_hash             VARCHAR(255) NOT NULL,
  portal_role               ENUM('supervisor', 'user') NOT NULL DEFAULT 'supervisor',
  portal_permissions        JSON NULL,
  is_active                 TINYINT(1) NOT NULL DEFAULT 1,
  failed_login_attempts     INT UNSIGNED NOT NULL DEFAULT 0,
  failed_login_window_start DATETIME NULL,
  locked_until              DATETIME NULL,
  credentials_version       INT UNSIGNED NOT NULL DEFAULT 0,
  last_login_at             DATETIME NULL,
  created_by_admin_id       INT UNSIGNED NULL,
  created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_operator_users_email (email),
  INDEX idx_operator_users_operator (operator_id),
  CONSTRAINT fk_operator_users_operator FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO operator_users
  (id, operator_id, name, email, password_hash, portal_role, portal_permissions,
   is_active, credentials_version, created_at)
SELECT o.id, o.id, o.client_name, o.email, o.password_hash, o.portal_role, o.portal_permissions,
       1, o.credentials_version, o.created_at
FROM operators o
WHERE NOT EXISTS (SELECT 1 FROM operator_users u WHERE u.operator_id = o.id);
