-- Patch 002: operator package field
ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS package_type VARCHAR(100) NOT NULL DEFAULT 'OTT' AFTER client_name;
