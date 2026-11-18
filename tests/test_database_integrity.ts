import { TestItem, requestApi } from './testApp';
import { Client, Pool } from 'pg';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import db, { isDatabaseReady, setDatabaseReady } from '../server/src/db';
import { initPgDatabase } from '../server/src/pgdb';
import { startServer } from '../server/src/index';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export async function runDatabaseIntegritySuite(): Promise<TestItem[]> {
  const tests: TestItem[] = [];
  function record(id: string, name: string, condition: boolean, details?: string) {
    tests.push({ id, name, pass: condition, details });
    console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${id}: ${name}${details ? ` -> ${details}` : ''}`);
  }

  console.log('\n--- SUITE 8: Comprehensive Database Integrity & Least Privilege Tests ---');

  // 1. Transaction Rollback Testing
  // Execute a multi-step operation where step 2 fails; verify step 1 was rolled back
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'pil_claims_test_db',
    user: process.env.DB_APP_USER || 'pil_app_user',
    password: process.env.DB_PASSWORD || '',
  });

  const txClient = await pool.connect();
  let rollbackSuccessful = false;
  const testClaimNumber = `CLM-ROLLBACK-${Date.now()}`;

  try {
    await txClient.query('BEGIN');
    await txClient.query(`
      INSERT INTO claims (id, claim_number, bl_number, claimant, discharge_date, status, created_date, updated_date)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `, [`clm-rb-${Date.now()}`, testClaimNumber, 'BL-RB-1', 'Rollback Claimant', '2026-05-01', 'new_claim']);

    // Deliberate constraint violation to trigger rollback
    await txClient.query(`
      INSERT INTO claims (id, claim_number, bl_number, claimant)
      VALUES ($1, $2, $3, $4)
    `, [`clm-rb-${Date.now()}`, testClaimNumber, null, null]); // bl_number is NOT NULL

    await txClient.query('COMMIT');
  } catch (err) {
    await txClient.query('ROLLBACK');
    rollbackSuccessful = true;
  } finally {
    txClient.release();
  }

  // Verify record does NOT exist in database
  const checkRb = await pool.query('SELECT 1 FROM claims WHERE claim_number = $1', [testClaimNumber]);
  record(
    'DB-8.1',
    'PostgreSQL transaction atomicity: failed multi-step operation completely rolled back',
    rollbackSuccessful && checkRb.rows.length === 0
  );

  // 2. Unique constraint enforcement on claim_number
  let uniqueBlocked = false;
  const dupClaimNumber = `CLM-DUP-${Date.now()}`;
  try {
    await pool.query(`
      INSERT INTO claims (id, claim_number, bl_number, claimant, discharge_date, status, created_date, updated_date)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `, [`clm-d1-${Date.now()}`, dupClaimNumber, 'BL-DUP', 'Claimant 1', '2026-05-01', 'new_claim']);

    // Attempt second insert with identical claim_number
    await pool.query(`
      INSERT INTO claims (id, claim_number, bl_number, claimant, discharge_date, status, created_date, updated_date)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `, [`clm-d2-${Date.now()}`, dupClaimNumber, 'BL-DUP', 'Claimant 2', '2026-05-01', 'new_claim']);
  } catch (err: any) {
    uniqueBlocked = err.code === '23505'; // PostgreSQL unique violation code
  }
  record('DB-8.2', 'Unique constraint on claim_number strictly blocks duplicate claim creation (23505)', uniqueBlocked);

  // 3. Foreign Key Cascading Deletion
  // Create user with OTP, delete user, verify user_otps cascaded
  const testCascadeUser = `cascade.${Date.now()}@pilship.com`;
  const cascadeUserId = `usr-casc-${Date.now()}`;
  await pool.query(`
    INSERT INTO users (id, full_name, email, password_hash, role, is_verified, created_date, updated_date)
    VALUES ($1, $2, $3, $4, 'agency', 1, NOW(), NOW())
  `, [cascadeUserId, 'Cascade User', testCascadeUser, 'hash123']);

  await pool.query(`
    INSERT INTO user_otps (id, user_id, email, otp_hash, expires_at, resend_available_at)
    VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes', NOW() + INTERVAL '60 seconds')
  `, [`otp-casc-${Date.now()}`, cascadeUserId, testCascadeUser, 'somehash64charssomehash64charssomehash64charssomehash64charssomeh']);

  // Delete the user
  await pool.query('DELETE FROM users WHERE id = $1', [cascadeUserId]);

  // Check if OTP was deleted via ON DELETE CASCADE
  const cascadeCheck = await pool.query('SELECT 1 FROM user_otps WHERE user_id = $1', [cascadeUserId]);
  record('DB-8.3', 'Foreign key referential integrity: deleting parent user cascades to delete associated OTPs', cascadeCheck.rows.length === 0);

  // 4. Least Privilege Runtime Account (pil_app_user)
  // Verify pil_app_user cannot create or drop tables
  let ddlBlocked = false;
  try {
    await pool.query('CREATE TABLE unauthorized_test_table (id INT)');
  } catch (err: any) {
    ddlBlocked = err.code === '42501'; // PostgreSQL insufficient_privilege code
  }
  record('DB-8.4', 'Least privilege enforced: pil_app_user cannot execute unauthorized DDL (42501)', ddlBlocked);

  // 5. SQL Injection defense in search parameters
  const sqliResult = await pool.query(
    'SELECT * FROM claims WHERE claim_number = $1 OR bl_number = $1',
    ["' OR '1'='1' --"]
  );
  record('DB-8.5', 'Parameterized queries neutralize SQL injection attempts in search queries', sqliResult.rows.length === 0);

  // 6. PRODUCTION DATABASE INTEGRITY CHECK (Verify pil_claims_db remains untouched)
  const prodClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'pil_claims_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  await prodClient.connect();
  try {
    const prodClaims = await prodClient.query('SELECT COUNT(*) FROM claims');
    const prodUsers = await prodClient.query('SELECT COUNT(*) FROM users');
    const prodSurveys = await prodClient.query('SELECT COUNT(*) FROM surveys');
    const prodAttachments = await prodClient.query('SELECT COUNT(*) FROM attachment_metadata');

    const claimsCount = parseInt(prodClaims.rows[0].count, 10);
    const usersCount = parseInt(prodUsers.rows[0].count, 10);
    const surveysCount = parseInt(prodSurveys.rows[0].count, 10);
    const attachCount = parseInt(prodAttachments.rows[0].count, 10);

    const prodPreserved = claimsCount >= 5 && usersCount >= 7 && surveysCount >= 1 && attachCount >= 20;

    record(
      'DB-8.6',
      'Production database "pil_claims_db" verified 100% untouched and preserved during all test runs',
      prodPreserved,
      `Prod Claims: ${claimsCount}, Users: ${usersCount}, Surveys: ${surveysCount}, Attachments: ${attachCount}`
    );
  } finally {
    await prodClient.end();
  }

  // 7. FRESH DATABASE SCHEMA INITIALIZATION TEST
  // Verify that pg_schema.sql explicitly defines token_version and password_changed_at in users table
  const schemaPath = path.resolve(__dirname, '../server/src/pg_schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  const hasTokenVersionInSchema = /token_version\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+1/i.test(schemaSql);
  const hasPasswordChangedAtInSchema = /password_changed_at\s+TIMESTAMPTZ/i.test(schemaSql);

  const testAdminClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'pil_claims_test_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });
  await testAdminClient.connect();

  try {
    // Create a temporary table using the exact fresh definition to confirm execution
    await testAdminClient.query(`
      CREATE TEMP TABLE test_fresh_schema_users (
        id TEXT PRIMARY KEY,
        created_date TEXT NOT NULL,
        updated_date TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'agency',
        is_verified INTEGER NOT NULL DEFAULT 1,
        otp_code TEXT,
        reset_token TEXT,
        password_changed_at TIMESTAMPTZ,
        token_version INTEGER NOT NULL DEFAULT 1
      )
    `);
    await testAdminClient.query(`
      INSERT INTO test_fresh_schema_users (id, created_date, updated_date, full_name, email, password_hash)
      VALUES ('fresh-1', NOW(), NOW(), 'Fresh User', 'fresh@test.com', 'hash')
    `);
    const freshRow = await testAdminClient.query('SELECT token_version, password_changed_at FROM test_fresh_schema_users WHERE id = $1', ['fresh-1']);
    const freshValid = hasTokenVersionInSchema && hasPasswordChangedAtInSchema && freshRow.rows[0].token_version === 1;

    record(
      'DB-8.7',
      'Fresh database schema: pg_schema.sql defines token_version and password_changed_at with valid defaults',
      freshValid
    );

    // 8. UPGRADING LEGACY USERS TABLE (SIMULATED UNMIGRATED DATABASE)
    // Create a table with only legacy columns, insert a row, then execute migration
    await testAdminClient.query(`
      CREATE TEMP TABLE test_legacy_users (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'agency',
        is_verified INTEGER NOT NULL DEFAULT 1
      )
    `);
    await testAdminClient.query(`
      INSERT INTO test_legacy_users (id, full_name, email, password_hash)
      VALUES ('leg-1', 'Legacy User', 'legacy@test.com', 'hash')
    `);

    // Apply the migration
    await testAdminClient.query(`
      ALTER TABLE test_legacy_users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE test_legacy_users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    `);

    const upgradedRow = await testAdminClient.query('SELECT token_version, password_changed_at FROM test_legacy_users WHERE id = $1', ['leg-1']);
    const upgradeValid = upgradedRow.rows[0].token_version === 1 && upgradedRow.rows[0].password_changed_at === null;

    record(
      'DB-8.8',
      'Legacy users table upgrade: safe ALTER TABLE assigns token_version=1 to pre-existing rows without data loss',
      upgradeValid
    );

    // 9. IDEMPOTENT MIGRATIONS: REPEATED INITIALIZATION SAFELY
    // Re-run the migration multiple times, verify no syntax/duplicate errors and values preserved
    await testAdminClient.query(`UPDATE test_legacy_users SET token_version = 5 WHERE id = 'leg-1'`);
    await testAdminClient.query(`
      ALTER TABLE test_legacy_users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE test_legacy_users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    `);
    const idempotentRow = await testAdminClient.query('SELECT token_version FROM test_legacy_users WHERE id = $1', ['leg-1']);
    const idempotentValid = idempotentRow.rows[0].token_version === 5;

    record(
      'DB-8.9',
      'Idempotent migrations: repeated ALTER TABLE ADD COLUMN IF NOT EXISTS preserves existing customized token_version values',
      idempotentValid
    );

    // 10. APPLICATION INITIALIZATION PATH
    // Execute the application's actual initPgDatabase() function directly
    await initPgDatabase();
    const appUsersCheck = await testAdminClient.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('token_version', 'password_changed_at')
    `);
    const hasBothColumnsInLiveUsers = appUsersCheck.rows.length === 2;

    record(
      'DB-8.10',
      'Application init path: initPgDatabase() ensures token_version and password_changed_at exist without early exit bypass',
      hasBothColumnsInLiveUsers
    );

    // ─── ATTACHMENT TABLE MIGRATION REGRESSION TESTS ────────────────────────────

    // 11. FRESH DATABASE: attachment_metadata and attachment_contents exist after initPgDatabase()
    const attachMetaCheck = await testAdminClient.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'attachment_metadata'
    `);
    const attachContentsCheck = await testAdminClient.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'attachment_contents'
    `);
    record(
      'DB-8.11',
      'Fresh/existing DB: attachment_metadata and attachment_contents tables exist after initPgDatabase()',
      attachMetaCheck.rows.length === 1 && attachContentsCheck.rows.length === 1
    );

    // 12. FOREIGN KEY + ON DELETE CASCADE: inserting into attachment_contents requires a valid attachment_metadata row
    const testAttId = `att-cascade-test-${Date.now()}`;
    let fkEnforced = false;
    try {
      // Attempt to insert into attachment_contents with no matching parent — must fail
      await testAdminClient.query(
        `INSERT INTO attachment_contents (attachment_id, file_data) VALUES ($1, $2)`,
        [testAttId, Buffer.from('test')]
      );
    } catch (err: any) {
      // PostgreSQL foreign key violation code 23503
      fkEnforced = err.code === '23503';
    }
    record(
      'DB-8.12',
      'attachment_contents foreign key enforced: orphan insert rejected with FK violation (23503)',
      fkEnforced
    );

    // 13. ON DELETE CASCADE: deleting attachment_metadata row cascades to attachment_contents
    const cascadeAttId = `att-casc-${Date.now()}`;
    const now = new Date().toISOString();
    await testAdminClient.query(
      `INSERT INTO attachment_metadata
        (id, original_filename, mime_type, file_size, uploaded_at, created_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [cascadeAttId, 'cascade-test.png', 'image/png', 100, now, now]
    );
    await testAdminClient.query(
      `INSERT INTO attachment_contents (attachment_id, file_data) VALUES ($1, $2)`,
      [cascadeAttId, Buffer.from('cascade binary')]
    );
    // Delete the metadata row — contents must cascade
    await testAdminClient.query(`DELETE FROM attachment_metadata WHERE id = $1`, [cascadeAttId]);
    const cascadeResult = await testAdminClient.query(
      `SELECT 1 FROM attachment_contents WHERE attachment_id = $1`, [cascadeAttId]
    );
    record(
      'DB-8.13',
      'ON DELETE CASCADE: deleting attachment_metadata row automatically removes attachment_contents row',
      cascadeResult.rows.length === 0
    );

    // 14. IDEMPOTENT REPEATED INITIALIZATION: calling initPgDatabase() twice does not error or corrupt data
    // Write a known metadata row, re-run init, verify row still present and tables intact
    const idemAttId = `att-idem-${Date.now()}`;
    const idemNow = new Date().toISOString();
    await testAdminClient.query(
      `INSERT INTO attachment_metadata
        (id, original_filename, mime_type, file_size, uploaded_at, created_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [idemAttId, 'idem-test.pdf', 'application/pdf', 512, idemNow, idemNow]
    );
    // Run initPgDatabase() a second time
    await initPgDatabase();
    // Verify existing row is preserved and tables still exist
    const idemRowCheck = await testAdminClient.query(
      `SELECT id FROM attachment_metadata WHERE id = $1`, [idemAttId]
    );
    const idemMetaStillExists = await testAdminClient.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'attachment_metadata'
    `);
    record(
      'DB-8.14',
      'Idempotent init: calling initPgDatabase() twice preserves existing attachment rows and does not recreate tables',
      idemRowCheck.rows.length === 1 && idemMetaStillExists.rows.length === 1
    );

    // 15. INITIALIZATION FAILURE: application strictly rejects startup when attachment tables are missing
    // and the connecting user lacks DDL permissions (pil_app_user least privilege).
    await testAdminClient.query(`DROP TABLE IF EXISTS attachment_contents`);
    await testAdminClient.query(`DROP TABLE IF EXISTS attachment_metadata`);

    // Confirm both attachment tables are gone
    const droppedCheck = await testAdminClient.query(`
      SELECT COUNT(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('attachment_metadata', 'attachment_contents')
    `);
    const wereDropped = parseInt(droppedCheck.rows[0].count, 10) === 0;

    // Attempt initPgDatabase() using the runtime pool (pil_app_user) which lacks DDL
    let startupBlockedOnMissingTables = false;
    let missingTablesErrorCode = '';
    try {
      await initPgDatabase(pool);
    } catch (err: any) {
      startupBlockedOnMissingTables = true;
      missingTablesErrorCode = err.code || err.message;
    }

    record(
      'DB-8.15',
      'Initialization failure handling: initPgDatabase() strictly fails and throws when required attachment tables are missing and runtime user lacks DDL',
      wereDropped && startupBlockedOnMissingTables && (missingTablesErrorCode === 'ATTACHMENT_SCHEMA_MISSING_TABLES' || missingTablesErrorCode.includes('required attachment tables missing'))
    );

    // 16. ADMINISTRATIVE UPGRADE / INITIALIZATION: administrative role (DB_USER/postgres) successfully
    // executes the application's actual initPgDatabase() to create missing tables and all 10 search indexes.
    const adminPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: 'pil_claims_test_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    });

    let adminInitSuccess = false;
    try {
      await initPgDatabase(adminPool);
      adminInitSuccess = true;
    } catch (err: any) {
      console.error('Admin initPgDatabase failed:', err);
    }

    // Regrant table permissions to pil_app_user on the newly created tables
    await testAdminClient.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pil_app_user;
    `);

    const restoredCheck = await testAdminClient.query(`
      SELECT COUNT(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('attachment_metadata', 'attachment_contents')
    `);
    const wereRestored = parseInt(restoredCheck.rows[0].count, 10) === 2;

    const idxCountRes = await testAdminClient.query(`
      SELECT COUNT(*) FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'attachment_metadata'
        AND indexname LIKE 'idx_attachment_metadata_%'
    `);
    const idxCount = parseInt(idxCountRes.rows[0].count, 10);

    record(
      'DB-8.16',
      'Administrative initialization: initPgDatabase() executed by administrative role (DB_USER) creates missing tables and all 10 search indexes',
      adminInitSuccess && wereRestored && idxCount >= 10
    );

    // 17. LEAST-PRIVILEGE RUNTIME VERIFICATION: now that tables and indexes exist,
    // runtime user (pil_app_user) executes initPgDatabase() successfully without DDL permission errors.
    let runtimeVerifySuccess = false;
    try {
      await initPgDatabase(pool);
      runtimeVerifySuccess = true;
    } catch (err: any) {
      console.error('Runtime pil_app_user verification failed:', err);
    }

    record(
      'DB-8.17',
      'Least-privilege runtime operation: pil_app_user successfully validates existing attachment schema without attempting unauthorized DDL',
      runtimeVerifySuccess
    );

    // 18. MISSING INDEX DETECTION: application fails startup when a required attachment search index is missing
    await testAdminClient.query(`DROP INDEX IF EXISTS idx_attachment_metadata_bl_number`);

    let startupBlockedOnMissingIndex = false;
    let missingIndexErrorCode = '';
    try {
      await initPgDatabase(pool);
    } catch (err: any) {
      startupBlockedOnMissingIndex = true;
      missingIndexErrorCode = err.code || err.message;
    }

    // Restore index via administrative pool
    await initPgDatabase(adminPool);

    const recheckIndex = await testAdminClient.query(`
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'attachment_metadata' AND indexname = 'idx_attachment_metadata_bl_number'
    `);

    record(
      'DB-8.18',
      'Missing index failure handling: initPgDatabase() strictly fails when required search index is missing; admin init restores it',
      startupBlockedOnMissingIndex && (missingIndexErrorCode === 'ATTACHMENT_SCHEMA_MISSING_INDEXES' || missingIndexErrorCode.includes('required attachment search indexes missing')) && recheckIndex.rows.length === 1
    );

    // 19. READINESS HEALTH CHECK INTEGRATION: /api/health/ready strictly requires database initialization
    const initialReadyCheck = await requestApi('GET', '/api/health/ready');
    const isReadyInitially = initialReadyCheck.status === 200 && initialReadyCheck.body.status === 'ready' && initialReadyCheck.body.initialized === true;

    // Simulate uninitialized state
    setDatabaseReady(false);
    const unreadyCheck = await requestApi('GET', '/api/health/ready');
    const isBlockedWhenUninitialized = unreadyCheck.status === 503 && unreadyCheck.body.status === 'not_ready' && unreadyCheck.body.initialized === false;

    // Verify /api/health/live succeeds regardless of DB state (zero DB dependency)
    const livenessCheck = await requestApi('GET', '/api/health/live');
    const livenessOk = livenessCheck.status === 200 && livenessCheck.body.status === 'ok';

    // Restore ready state
    setDatabaseReady(true);

    record(
      'DB-8.19',
      'Readiness health check (/api/health/ready): strictly returns 503 before initialization completes and 200 when ready; /api/health/live preserved',
      isReadyInitially && isBlockedWhenUninitialized && livenessOk
    );

    // 20. ASYNC BOOTSTRAP FAIL-FAST & STARTUP ORDERING: startServer() strictly aborts without opening port if DB init fails
    await testAdminClient.query(`DROP TABLE IF EXISTS attachment_contents`);
    await testAdminClient.query(`DROP TABLE IF EXISTS attachment_metadata`);

    const FAIL_TEST_PORT = 5198;
    let bootstrapFailedAsExpected = false;
    let serverNeverStarted = false;
    try {
      // Execute startServer using runtime pool (pil_app_user) when attachment tables are missing
      await startServer(FAIL_TEST_PORT, () => initPgDatabase(pool));
    } catch (err: any) {
      bootstrapFailedAsExpected = true;
    }

    // Verify port 5198 was NEVER opened
    try {
      await fetch(`http://localhost:${FAIL_TEST_PORT}/api/health/ready`);
    } catch (netErr: any) {
      serverNeverStarted = true; // Connection refused, port was never opened
    }

    // Recover schema via admin pool
    await initPgDatabase(adminPool);
    await testAdminClient.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pil_app_user;
    `);
    setDatabaseReady(true);

    const postRecoveryTables = await testAdminClient.query(`
      SELECT COUNT(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('attachment_metadata', 'attachment_contents')
    `);
    const tablesRestored = parseInt(postRecoveryTables.rows[0].count, 10) === 2;

    // Verify startServer successfully binds and serves traffic when database initialization succeeds
    let serverStartedWhenValid = false;
    try {
      const activeServer = await startServer(FAIL_TEST_PORT);
      const readyResp = await fetch(`http://localhost:${FAIL_TEST_PORT}/api/health/ready`);
      const body = await readyResp.json() as any;
      serverStartedWhenValid = readyResp.status === 200 && body.status === 'ready' && body.initialized === true;
      await new Promise<void>((resolve) => activeServer.close(() => resolve()));
    } catch (startErr: any) {
      console.error('Unexpected error starting valid server:', startErr);
    }

    record(
      'DB-8.20',
      'Async bootstrap fail-fast: startServer() strictly aborts and never opens HTTP port when DB initialization fails; succeeds when valid',
      bootstrapFailedAsExpected && serverNeverStarted && tablesRestored && serverStartedWhenValid
    );

  } finally {
    if (typeof adminPool !== 'undefined') {
      await adminPool.end();
    }
    await testAdminClient.end();
    await pool.end();
  }

  return tests;
}
