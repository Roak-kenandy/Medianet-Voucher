import bcrypt from 'bcrypt';
import { config } from '../config/index.js';
import pool, { getConnection } from './pool.js';
import { resetAdminPasswordSchema } from '../validators/schemas.js';

/**
 * Sets a staff password from the command line (recovery when nobody can sign in, or to
 * replace the default seed password). The password is read from ADMIN_NEW_PASSWORD so it
 * does not end up in shell history or the process list.
 *
 *   ADMIN_NEW_PASSWORD='...' npm run admin:set-password -- staff@example.com
 */
async function main() {
  const email = String(process.argv[2] || '').toLowerCase().trim();
  const password = process.env.ADMIN_NEW_PASSWORD || '';
  if (!email) {
    throw new Error('Usage: ADMIN_NEW_PASSWORD=<password> npm run admin:set-password -- <staff email>');
  }

  const parsed = resetAdminPasswordSchema.safeParse({ password });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
  }

  const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT id FROM admins WHERE email = ? LIMIT 1 FOR UPDATE', [email]);
    if (!rows.length) {
      throw new Error(`No staff account with email ${email}`);
    }
    const adminId = rows[0].id;
    await connection.execute(
      `UPDATE admins
       SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL,
           failed_login_window_start = NULL, credentials_version = credentials_version + 1
       WHERE id = ?`,
      [passwordHash, adminId]
    );
    await connection.execute(
      `UPDATE refresh_tokens SET revoked_at = NOW(), revoked_reason = 'password_reset'
       WHERE user_type = 'admin' AND user_id = ? AND revoked_at IS NULL`,
      [adminId]
    );
    await connection.execute(
      `INSERT INTO audit_logs (actor_type, actor_id, action, resource_type, resource_id)
       VALUES ('system', NULL, 'ADMIN_PASSWORD_SET_VIA_CLI', 'admin', ?)`,
      [adminId]
    );
    await connection.commit();
    console.log(`Password updated for ${email}. All of that account's sessions were ended.`);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

main()
  .catch((err) => {
    console.error('Set password failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
