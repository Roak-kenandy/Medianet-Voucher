-- Store multiple packages provisioned per voucher account

CREATE TABLE IF NOT EXISTS voucher_account_packages (
  voucher_account_id INT UNSIGNED NOT NULL,
  package_id         INT UNSIGNED NOT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (voucher_account_id, package_id),
  CONSTRAINT fk_vap_voucher_account FOREIGN KEY (voucher_account_id) REFERENCES voucher_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_vap_package FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE RESTRICT,
  INDEX idx_vap_package (package_id)
);

INSERT IGNORE INTO voucher_account_packages (voucher_account_id, package_id)
SELECT id, package_id FROM voucher_accounts WHERE package_id IS NOT NULL;
