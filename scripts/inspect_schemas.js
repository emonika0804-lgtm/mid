const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const sqlite = new Database(path.resolve(__dirname, '../pil_claims.db'), { readonly: true });
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function inspect() {
  console.log('=== 1. SQLITE TABLES & ROW COUNTS ===');
  const sqliteTables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();

  const sqliteMap = {};
  for (const t of sqliteTables) {
    const count = sqlite.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get().c;
    const cols = sqlite.prepare(`PRAGMA table_info("${t.name}")`).all().map(c => c.name);
    sqliteMap[t.name] = { count, cols };
    console.log(`  • ${t.name.padEnd(16)}: ${String(count).padStart(3)} rows | ${cols.length} columns`);
  }

  console.log('\n=== 2. POSTGRESQL TABLES & ROW COUNTS ===');
  const pgTables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
  );

  const pgMap = {};
  for (const r of pgTables.rows) {
    const countRes = await pool.query(`SELECT COUNT(*)::int as c FROM "${r.table_name}"`);
    const colRes = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
      [r.table_name]
    );
    const cols = colRes.rows.map(c => c.column_name);
    const count = countRes.rows[0].c;
    pgMap[r.table_name] = { count, cols };
    console.log(`  • ${r.table_name.padEnd(20)}: ${String(count).padStart(3)} rows | ${cols.length} columns`);
  }

  console.log('\n=== 3. COLUMN COMPARISON (SQLite vs PostgreSQL) ===');
  for (const t of sqliteTables) {
    const tableName = t.name;
    if (!pgMap[tableName]) {
      console.log(`  ⚠️ Table ${tableName} is missing in PostgreSQL!`);
      continue;
    }
    const sqliteCols = sqliteMap[tableName].cols;
    const pgCols = pgMap[tableName].cols;
    const missingInPg = sqliteCols.filter(c => !pgCols.includes(c));
    if (missingInPg.length > 0) {
      console.log(`  ❌ ${tableName} missing columns in PG:`, missingInPg);
    } else {
      console.log(`  ✅ ${tableName.padEnd(16)}: all ${sqliteCols.length} columns match in PostgreSQL.`);
    }
  }

  await pool.end();
  sqlite.close();
}

inspect().catch(err => {
  console.error('Inspection failed:', err);
  process.exit(1);
});
