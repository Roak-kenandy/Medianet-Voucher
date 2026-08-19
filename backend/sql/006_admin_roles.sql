-- Staff roles on admin portal users: admin (full), sales, finance

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS role ENUM('admin', 'sales', 'finance') NOT NULL DEFAULT 'admin' AFTER email;

UPDATE admins SET role = 'admin' WHERE role IS NULL OR role = '';
