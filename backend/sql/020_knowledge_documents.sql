CREATE TABLE IF NOT EXISTS knowledge_documents (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title               VARCHAR(200) NOT NULL,
  description         TEXT NULL,
  file_filename       VARCHAR(255) NOT NULL,
  file_original_name  VARCHAR(255) NOT NULL,
  mime_type           VARCHAR(120) NOT NULL,
  file_size           INT UNSIGNED NOT NULL DEFAULT 0,
  sort_order          INT NOT NULL DEFAULT 0,
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  created_by_admin_id INT UNSIGNED NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_knowledge_documents_active (is_active, sort_order),
  CONSTRAINT fk_knowledge_documents_admin FOREIGN KEY (created_by_admin_id) REFERENCES admins(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
