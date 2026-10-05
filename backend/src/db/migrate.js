import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';
import { isProduction } from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATION_LOCK_NAME = 'medianet_voucher_schema_migrate';
const MIGRATION_LOCK_TIMEOUT_SECONDS = 10;

/**
 * Files that existed before the migration ledger was introduced. Only these may be
 * marked as applied without running them when an old database is bootstrapped.
 */
const PRE_LEDGER_MIGRATIONS = new Set([
  '001_schema.sql',
  '002_patch.sql',
  '003_drop_promotions.sql',
  '004_packages.sql',
  '005_operator_packages.sql',
  '006_admin_roles.sql',
  '007_voucher_account_package.sql',
  '008_voucher_account_packages.sql',
  '009_operator_wallets.sql',
  '010_operator_wallet_commission.sql',
  '011_service_tags.sql',
  '012_operator_service_scope.sql',
  '013_wallet_commission_multiplier.sql',
  '014_operator_trial_period.sql',
  '015_operator_trial_accounts.sql',
  '016_operator_wallet_self_topup.sql',
  '017_operator_portal_roles.sql',
  '018_voucher_account_origin_activity.sql',
  '019_marketing_ads.sql',
  '020_knowledge_documents.sql',
]);

function parseStatements(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function loadAppliedFilenames(connection) {
  const [rows] = await connection.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((row) => row.filename));
}

/** Existing DBs that ran migrations before the ledger existed — mark prior SQL as applied. */
async function bootstrapMigrationLedger(connection, files) {
  const applied = await loadAppliedFilenames(connection);
  if (applied.size > 0) {
    return;
  }

  const [tables] = await connection.query(`SHOW TABLES LIKE 'admins'`);
  if (!tables.length) {
    return;
  }

  for (const file of files) {
    if (!PRE_LEDGER_MIGRATIONS.has(file)) {
      continue;
    }
    await connection.query('INSERT IGNORE INTO schema_migrations (filename) VALUES (?)', [file]);
    console.log(`Migration ledger: recorded ${file} (already applied)`);
  }
}

async function acquireMigrationLock(connection) {
  const [rows] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [
    MIGRATION_LOCK_NAME,
    MIGRATION_LOCK_TIMEOUT_SECONDS,
  ]);
  if (Number(rows[0]?.acquired) !== 1) {
    throw new Error('Another migration run is in progress. Try again when it finishes.');
  }
}

async function releaseMigrationLock(connection) {
  try {
    await connection.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK_NAME]);
  } catch {
    // Lock is released automatically when the connection closes.
  }
}

function assertProductionIntent() {
  if (isProduction && !process.argv.includes('--production')) {
    throw new Error(
      'Refusing to migrate a production database without --production. Take a backup, then run: npm run migrate:prod'
    );
  }
}

async function migrate() {
  assertProductionIntent();

  const sqlDir = path.join(__dirname, '../../sql');
  const files = fs
    .readdirSync(sqlDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const connection = await pool.getConnection();
  try {
    await acquireMigrationLock(connection);
    await ensureMigrationsTable(connection);
    await bootstrapMigrationLedger(connection, files);

    const applied = await loadAppliedFilenames(connection);

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8');
      const statements = parseStatements(sql);
      // MySQL DDL commits implicitly; the transaction still makes data-only migrations atomic.
      await connection.beginTransaction();
      try {
        for (const statement of statements) {
          await connection.query(statement);
        }
        await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
        await connection.commit();
      } catch (err) {
        await connection.rollback().catch(() => {});
        throw new Error(`${file}: ${err.message}`);
      }
      console.log(`Applied: ${file}`);
    }

    // Fills the configurable CRM tables from .env defaults (idempotent).
    const { bootstrapCrmConfig } = await import('../services/crmConfigService.js');
    await bootstrapCrmConfig();

    console.log('Database migration completed successfully.');
  } finally {
    await releaseMigrationLock(connection);
    connection.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
