import bcrypt from 'bcrypt';
import { config } from '../config/index.js';
import pool from './pool.js';

const SEED_EMAIL = config.seed.adminEmail.toLowerCase().trim();

async function ensureSeedAdmin(connection) {
  const passwordHash = await bcrypt.hash(config.seed.adminPassword, config.security.bcryptRounds);

  const [rows] = await connection.execute('SELECT id FROM admins WHERE email = ? LIMIT 1', [
    SEED_EMAIL,
  ]);

  if (rows.length > 0) {
    await connection.execute(
      `UPDATE admins
       SET name = ?, password_hash = ?, role = 'admin', is_active = 1,
           failed_login_attempts = 0, locked_until = NULL
       WHERE email = ?`,
      [config.seed.adminName, passwordHash, SEED_EMAIL]
    );
    console.log(`Kept seed admin: ${SEED_EMAIL}`);
    return;
  }

  await connection.execute(
    `INSERT INTO admins (name, email, role, password_hash, is_active)
     VALUES (?, ?, 'admin', ?, 1)`,
    [config.seed.adminName, SEED_EMAIL, passwordHash]
  );
  console.log(`Created seed admin: ${SEED_EMAIL}`);
}

async function reset() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute('SET FOREIGN_KEY_CHECKS = 0');

    const tables = [
      'wallet_transactions',
      'voucher_account_packages',
      'voucher_accounts',
      'operator_packages',
      'operators',
      'packages',
      'refresh_tokens',
      'audit_logs',
    ];

    for (const table of tables) {
      await connection.execute(`TRUNCATE TABLE ${table}`);
      console.log(`Cleared: ${table}`);
    }

    const [deleteResult] = await connection.execute('DELETE FROM admins WHERE email != ?', [
      SEED_EMAIL,
    ]);
    console.log(`Removed ${deleteResult.affectedRows} other admin account(s)`);

    await connection.execute('SET FOREIGN_KEY_CHECKS = 1');

    await ensureSeedAdmin(connection);

    await connection.commit();

    console.log('\nDatabase reset complete.');
    console.log(`  Login: ${SEED_EMAIL}`);
    console.log('  Password: (from SEED_ADMIN_PASSWORD — not logged for security)');
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
    await pool.end();
  }
}

reset().catch((err) => {
  console.error('Reset failed:', err.message);
  process.exit(1);
});
