import bcrypt from 'bcrypt';
import { config, isProduction } from '../config/index.js';
import { query } from './pool.js';
import pool from './pool.js';

if (isProduction && config.seed.adminPassword === 'ChangeMe@Secure123') {
  console.error(
    'Refusing to seed with default SEED_ADMIN_PASSWORD in production. Set a strong SEED_ADMIN_PASSWORD first.'
  );
  process.exit(1);
}

async function seed() {
  const existing = await query('SELECT id FROM admins WHERE email = ? LIMIT 1', [
    config.seed.adminEmail,
  ]);

  if (existing.length > 0) {
    console.log('Seed admin already exists. Skipping.');
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(config.seed.adminPassword, config.security.bcryptRounds);

  await query(
    `INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)`,
    [config.seed.adminName, config.seed.adminEmail, passwordHash]
  );

  console.log('Seed admin created:');
  console.log(`  Email: ${config.seed.adminEmail}`);
  console.log('  Password: (from SEED_ADMIN_PASSWORD — not logged for security)');
  console.log('Change the password after first login.');

  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
