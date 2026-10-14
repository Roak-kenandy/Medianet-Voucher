-- Front office staff role: dashboard, operator wallet top-ups and reports.
ALTER TABLE admins
  MODIFY COLUMN role ENUM('admin', 'sales', 'finance', 'front_office') NOT NULL DEFAULT 'admin';
