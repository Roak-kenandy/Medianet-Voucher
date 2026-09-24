import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    if (file === '021_schema_migrations.sql') {
      continue;
    }
    await connection.query('INSERT IGNORE INTO schema_migrations (filename) VALUES (?)', [file]);
    console.log(`Migration ledger: recorded ${file} (already applied)`);
  }
}

async function migrate() {
  const sqlDir = path.join(__dirname, '../../sql');
  const files = fs
    .readdirSync(sqlDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const connection = await pool.getConnection();
  try {
    await ensureMigrationsTable(connection);
    await bootstrapMigrationLedger(connection, files);

    const applied = await loadAppliedFilenames(connection);

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8');
      const statements = parseStatements(sql);
      for (const statement of statements) {
        await connection.query(statement);
      }
      await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log(`Applied: ${file}`);
    }

    console.log('Database migration completed successfully.');
  } finally {
    connection.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
