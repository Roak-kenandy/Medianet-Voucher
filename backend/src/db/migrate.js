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

async function migrate() {
  const sqlDir = path.join(__dirname, '../../sql');
  const files = fs
    .readdirSync(sqlDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const connection = await pool.getConnection();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8');
      const statements = parseStatements(sql);
      for (const statement of statements) {
        await connection.query(statement);
      }
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
