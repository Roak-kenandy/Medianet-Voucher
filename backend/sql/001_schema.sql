-- Medianet Voucher Portal Schema
-- Run: npm run migrate

CREATE TABLE IF NOT EXISTS admins (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until  DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operators (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id          INT UNSIGNED NOT NULL,
  client_name       VARCHAR(200) NOT NULL,
  package_type      VARCHAR(100) NOT NULL DEFAULT 'OTT',
  email             VARCHAR(255) NOT NULL UNIQUE,
  password_hash     VARCHAR(255) NOT NULL,
  account_quota     INT UNSIGNED NOT NULL DEFAULT 0,
  accounts_created  INT UNSIGNED NOT NULL DEFAULT 0,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until      DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_operators_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE RESTRICT,
  INDEX idx_operators_email (email),
  INDEX idx_operators_admin (admin_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS voucher_accounts (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  operator_id   INT UNSIGNED NOT NULL,
  full_name     VARCHAR(200) NOT NULL,
  phone_number  VARCHAR(20) NOT NULL,
  status        ENUM('pending', 'processing', 'created', 'failed') NOT NULL DEFAULT 'pending',
  external_ref  VARCHAR(255) NULL,
  error_message TEXT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_voucher_accounts_operator FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE RESTRICT,
  INDEX idx_voucher_accounts_operator (operator_id),
  INDEX idx_voucher_accounts_phone (phone_number),
  INDEX idx_voucher_accounts_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_type     ENUM('admin', 'operator') NOT NULL,
  user_id       INT UNSIGNED NOT NULL,
  token_hash    CHAR(64) NOT NULL,
  expires_at    DATETIME NOT NULL,
  revoked_at    DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_refresh_tokens_hash (token_hash),
  INDEX idx_refresh_tokens_user (user_type, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_type    ENUM('admin', 'operator', 'system') NOT NULL,
  actor_id      INT UNSIGNED NULL,
  action        VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NULL,
  resource_id   INT UNSIGNED NULL,
  ip_address    VARCHAR(45) NULL,
  user_agent    VARCHAR(512) NULL,
  metadata      JSON NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_logs_actor (actor_type, actor_id),
  INDEX idx_audit_logs_action (action),
  INDEX idx_audit_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
