import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { pool, initPgDatabase, testConnection } from './pgdb';
import { ensureDatabaseExists } from './ensure_pg_db';

const PRIMARY_KEYS: Record<string, string> = {
  users: 'id',
  claims: 'id',
  surveys: 'id',
  lms_cache: 'bl_number',
  audit_logs: 'id',
  expenses: 'id',
  recoveries: 'id',
  notifications: 'id',
  currency_rates: 'id',
  file_uploads: 'filename',
};

async function migrate() {
  console.log('===========================================================');
  console.log('  PIL Cargo Claims: SQLite -> PostgreSQL Migration');
  console.log('===========================================================\n');

  // 1. Verify SQLite database exists
  const sqlitePath = path.resolve(__dirname, '../../pil_claims.db');
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found at: ${sqlitePath}`);
  }
  const sqlite = new Database(sqlitePath, { readonly: true });
  console.log('✅ SQLite database connected in READ-ONLY mode.');

  // 2. Ensure target PostgreSQL database exists
  await ensureDatabaseExists();

  // 3. Test PostgreSQL connection
  const connTest = await testConnection();
  if (!connTest.ok) {
    console.error('❌ Could not connect to PostgreSQL:', connTest.error);
    process.exit(1);
  }
  console.log('✅ PostgreSQL connection verified successfully.');

  // 4. Initialize PostgreSQL schema
  console.log('Applying PostgreSQL schema...');
  await initPgDatabase();
  console.log('✅ PostgreSQL schema ready.\n');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('Starting migration transaction...\n');

    // Ordered to respect potential logical dependencies: users first, then parent entities, then children
    const tables = [
      'users',
      'claims',
      'surveys',
      'lms_cache',
      'audit_logs',
      'expenses',
      'recoveries',
      'notifications',
      'currency_rates',
      'file_uploads',
    ];

    const verificationSummary: { table: string; sqliteCount: number; pgCount: number }[] = [];

    for (const table of tables) {
      // Check if table exists in SQLite
      const tableCheck = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(table) as any;

      if (!tableCheck) {
        console.log(`- Table ${table} does not exist in SQLite; skipping.`);
        continue;
      }

      // Read rows from SQLite
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as any[];
      const sqliteCount = rows.length;

      if (sqliteCount > 0) {
        const columns = Object.keys(rows[0]);
        const colsList = columns.map((c) => `"${c}"`).join(', ');
        const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');

        const pk = PRIMARY_KEYS[table];
        let insertQuery: string;

        if (pk) {
          const updateCols = columns.filter((c) => c !== pk);
          const updateSet = updateCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
          insertQuery = `
            INSERT INTO "${table}" (${colsList})
            VALUES (${placeholders})
            ON CONFLICT ("${pk}") DO UPDATE SET ${updateSet}
          `;
        } else {
          insertQuery = `
            INSERT INTO "${table}" (${colsList})
            VALUES (${placeholders})
            ON CONFLICT DO NOTHING
          `;
        }

        for (const row of rows) {
          const values = columns.map((col) => row[col]);
          await client.query(insertQuery, values);
        }
      }

      // Verify count in PostgreSQL within the transaction
      const pgRes = await client.query(`SELECT COUNT(*)::int as c FROM "${table}"`);
      const pgCount = pgRes.rows[0].c;

      verificationSummary.push({ table, sqliteCount, pgCount });
      console.log(`  • ${table.padEnd(16)}: SQLite = ${String(sqliteCount).padStart(3)} | PostgreSQL = ${String(pgCount).padStart(3)}`);
    }

    console.log('\n--- DATA INTEGRITY & RELATIONSHIP VERIFICATION ---');

    // 1. Verify specific real user account
    const userCheck = await client.query(
      "SELECT id, email, full_name, role, is_verified FROM users WHERE email = 'yashwanthsakthivel@gmail.com'"
    );
    if (userCheck.rowCount === 0) {
      throw new Error('CRITICAL: Registered user yashwanthsakthivel@gmail.com was not found in PostgreSQL!');
    }
    console.log('✅ Real user account verified:', userCheck.rows[0].email, `(Role: ${userCheck.rows[0].role})`);

    // 2. Verify all Claim IDs match
    const sqliteClaimIds = sqlite.prepare('SELECT id FROM claims ORDER BY id').all().map((r: any) => r.id);
    const pgClaimIds = (await client.query('SELECT id FROM claims ORDER BY id')).rows.map((r: any) => r.id);
    const missingClaims = sqliteClaimIds.filter((id: string) => !pgClaimIds.includes(id));
    if (missingClaims.length > 0) {
      throw new Error(`CRITICAL: Missing Claims in PostgreSQL: ${missingClaims.join(', ')}`);
    }
    console.log(`✅ All ${sqliteClaimIds.length} Claim records matched by Primary Key.`);

    // 3. Verify all Survey IDs match
    const sqliteSurveyIds = sqlite.prepare('SELECT id FROM surveys ORDER BY id').all().map((r: any) => r.id);
    const pgSurveyIds = (await client.query('SELECT id FROM surveys ORDER BY id')).rows.map((r: any) => r.id);
    const missingSurveys = sqliteSurveyIds.filter((id: string) => !pgSurveyIds.includes(id));
    if (missingSurveys.length > 0) {
      throw new Error(`CRITICAL: Missing Surveys in PostgreSQL: ${missingSurveys.join(', ')}`);
    }
    console.log(`✅ All ${sqliteSurveyIds.length} Survey records matched by Primary Key.`);

    // 4. Verify Relationships: Expenses and Recoveries linked to Claims
    const orphanExpenses = await client.query(
      'SELECT id, claim_id FROM expenses WHERE claim_id NOT IN (SELECT id FROM claims)'
    );
    if (orphanExpenses.rowCount! > 0) {
      throw new Error(`Orphan expenses detected: ${orphanExpenses.rows.length}`);
    }
    console.log('✅ Expense-to-Claim foreign key relationship verified (0 orphan records).');

    const orphanRecoveries = await client.query(
      'SELECT id, claim_id FROM recoveries WHERE claim_id NOT IN (SELECT id FROM claims)'
    );
    if (orphanRecoveries.rowCount! > 0) {
      throw new Error(`Orphan recoveries detected: ${orphanRecoveries.rows.length}`);
    }
    console.log('✅ Recovery-to-Claim foreign key relationship verified (0 orphan records).');

    // 5. Verify JSON integrity on claims
    const pgClaimsJson = await client.query('SELECT id, attachments, email_thread, comments FROM claims');
    for (const c of pgClaimsJson.rows) {
      JSON.parse(c.attachments || '[]');
      JSON.parse(c.email_thread || '[]');
      JSON.parse(c.comments || '[]');
    }
    console.log('✅ All JSON fields (attachments, email_thread, comments) validated successfully.');

    // 6. Verify row count matches across all tables
    let hasMismatch = false;
    for (const v of verificationSummary) {
      if (v.sqliteCount !== v.pgCount) {
        console.error(`❌ Count mismatch on table ${v.table}: SQLite ${v.sqliteCount} vs PG ${v.pgCount}`);
        hasMismatch = true;
      }
    }

    if (hasMismatch) {
      throw new Error('Validation failed: Row count mismatch detected.');
    }

    await client.query('COMMIT');
    console.log('\n===========================================================');
    console.log('✅ TRANSACTION COMMITTED: All records migrated and verified!');
    console.log('===========================================================\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ MIGRATION ERROR — TRANSACTION ROLLED BACK:', err);
    throw err;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration aborted:', err);
  process.exit(1);
});
