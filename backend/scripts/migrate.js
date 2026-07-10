/**
 * Minimal SQL migration runner.
 *
 * Applies backend/migrations/*.sql in filename order, once each, recording
 * applied files in a schema_migrations table. Runs automatically:
 *   - in CI after schema.sql loads (proves migrations apply on a fresh DB)
 *   - on the server during deploy, before pm2 restart (this is how a push
 *     changes the production database)
 * A non-zero exit here fails the deploy, so a broken migration never leaves
 * the app running against a half-migrated schema silently.
 *
 * Run manually: node scripts/migrate.js   (or: npm run migrate)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function main() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST || 'localhost',
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'toppertest',
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  // name is VARCHAR(191): 191 x 4 bytes (utf8mb4) stays under the 1000-byte
  // index limit of older MySQL/MyISAM setups (e.g. local WAMP defaults).
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(191) NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [appliedRows] = await conn.query('SELECT name FROM schema_migrations');
  const applied = new Set(appliedRows.map(r => r.name));

  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
    : [];

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`Applying migration: ${file}`);
    try {
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      ran++;
    } catch (err) {
      console.error(`Migration ${file} FAILED: ${err.message}`);
      await conn.end();
      process.exit(1);
    }
  }

  console.log(ran ? `Done. ${ran} migration(s) applied.` : 'Nothing to apply — all migrations already recorded.');
  await conn.end();
}

main().catch(err => {
  console.error('Migration runner failed:', err.message);
  process.exit(1);
});
