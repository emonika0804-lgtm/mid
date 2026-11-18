import { Pool, types } from 'pg';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Parse NUMERIC (OID 1700) as JavaScript float to match frontend expectations
types.setTypeParser(1700, (val: string) => (val === null ? null : parseFloat(val)));

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ─── Connection Config ─────────────────────────────────────────────────────────
// Priority 1: DATABASE_URL connection string (Neon, Railway, Render, Heroku etc.)
// Priority 2: Separate DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD / DB_SSL vars (local PostgreSQL)
//
// For Neon, set:
//   DATABASE_URL=postgresql://neondb_owner:<password>@<host>.neon.tech/neondb?sslmode=require
//
// IMPORTANT: When DATABASE_URL is set, DB_APP_USER / DB_USER are IGNORED — the
// connection user is embedded in the DATABASE_URL itself.

function buildPoolConfig() {
  if (process.env.DATABASE_URL) {
    // Cloud-hosted PostgreSQL via connection string (Neon, etc.)
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Required for Neon / cloud PostgreSQL
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }

  // Dedicated application runtime user for local PostgreSQL.
  // Uses DB_APP_USER if set; otherwise falls back to DB_USER.
  // Does NOT substitute pil_app_user when DB_USER is explicitly provided,
  // to avoid connection failures when pil_app_user role doesn't exist.
  const runtimeDbUser = process.env.DB_APP_USER || process.env.DB_USER || 'postgres';

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'pil_claims_db',
    user: runtimeDbUser,
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

export const pool = new Pool(buildPoolConfig());

pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected client error on idle connection:', err);
});

/**
 * Execute a query with parameterized values
 */
export async function query(text: string, params?: any[]) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.DEBUG_SQL === 'true') {
    console.log('[PostgreSQL Query]', { text, duration: `${duration}ms`, rows: res.rowCount });
  }
  return res;
}

export const REQUIRED_ATTACHMENT_INDEXES = [
  { name: 'idx_attachment_metadata_bl_number', sql: 'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_bl_number ON attachment_metadata(bl_number)' },
  { name: 'idx_attachment_metadata_claim_number', sql: 'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_claim_number ON attachment_metadata(claim_number)' },
  { name: 'idx_attachment_metadata_survey_number', sql: 'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_survey_number ON attachment_metadata(survey_number)' },
  { name: 'idx_attachment_metadata_cms_number', sql: 'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_cms_number ON attachment_metadata(cms_reference_number)' },
  { name: 'idx_attachment_metadata_type', sql: 'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_type ON attachment_metadata(mandatory_attachment_type)' },
  { name: 'idx_attachment_metadata_uploaded_by_id', sql: 'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_uploaded_by_id ON attachment_metadata(uploaded_by_id)' },
  { name: 'idx_attachment_metadata_uploaded_at', sql: 'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_uploaded_at ON attachment_metadata(uploaded_at DESC)' },
  { name: 'idx_attachment_metadata_original_filename', sql: 'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_original_filename ON attachment_metadata(original_filename)' },
  { name: 'idx_attachment_metadata_claim_id', sql: 'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_claim_id ON attachment_metadata(claim_id)' },
  { name: 'idx_attachment_metadata_survey_id', sql: 'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_survey_id ON attachment_metadata(survey_id)' },
];

/**
 * Initialize PostgreSQL Schema from pg_schema.sql if needed, or verify and migrate existing tables.
 *
 * Schema DDL execution model & Least-Privilege Architecture:
 * - Administrative role: DB_USER (e.g. 'postgres') or cloud owner (e.g. 'neondb_owner') is expected
 *   to execute schema DDL (CREATE TABLE, ALTER TABLE, CREATE INDEX).
 * - Application runtime role: DB_APP_USER ('pil_app_user') has DML permissions only (SELECT, INSERT, UPDATE, DELETE).
 * - When required attachment tables and search indexes already exist, initPgDatabase verifies them
 *   without attempting DDL, allowing least-privilege runtime users to start up safely.
 * - If required attachment tables or search indexes are missing and cannot be created (e.g. due to
 *   insufficient privileges or database errors), an explicit error is thrown, preventing the
 *   application from starting in an incomplete/corrupted state.
 *
 * @param targetPool Optional pool to use (defaults to application runtime pool)
 */
export async function initPgDatabase(targetPool: Pool = pool) {
  const client = await targetPool.connect();
  try {
    // 1. Verify if key application tables exist
    const checkRes = await client.query(
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('claims', 'surveys', 'users')"
    );
    const existingCount = parseInt(checkRes.rows[0].count, 10);
    if (existingCount < 3) {
      // Fresh database: execute base schema
      const schemaPath = path.resolve(__dirname, 'pg_schema.sql');
      if (fs.existsSync(schemaPath)) {
        const sql = fs.readFileSync(schemaPath, 'utf-8');
        await client.query(sql);
        console.log('[PostgreSQL] Base schema successfully initialized from pg_schema.sql.');
      }
    } else {
      console.log('[PostgreSQL] Database tables verified and active.');
    }

    // 2. Safe, idempotent incremental schema migrations (executed for both fresh and existing databases)
    // Ensure the users table exists before attempting ALTER TABLE
    const usersTableCheck = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'"
    );
    if (usersTableCheck.rows.length > 0) {
      const usersCols = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name IN ('token_version', 'password_changed_at')
      `);
      const existingColNames = usersCols.rows.map((r: any) => r.column_name);
      if (!existingColNames.includes('token_version') || !existingColNames.includes('password_changed_at')) {
        try {
          await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
          `);
        } catch (alterErr: any) {
          console.error('[PostgreSQL] Users table ALTER TABLE migration note:', alterErr?.message || alterErr);
        }
      }
      console.log('[PostgreSQL] Users table schema migrations verified (token_version, password_changed_at).');
    }

    // 3. Attachment table migration & schema verification (Phase 3 / Phase 4 Document Management)
    // First, check which tables exist
    const checkTablesRes = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('attachment_metadata', 'attachment_contents')
    `);
    const existingTableNames = new Set(checkTablesRes.rows.map((r: any) => r.table_name));
    const hasMetadata = existingTableNames.has('attachment_metadata');
    const hasContents = existingTableNames.has('attachment_contents');

    // Second, check which search indexes exist
    let existingIndexNames = new Set<string>();
    if (hasMetadata) {
      const checkIndexesRes = await client.query(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'attachment_metadata'
      `);
      existingIndexNames = new Set(checkIndexesRes.rows.map((r: any) => r.indexname));
    }

    const missingIndexes = REQUIRED_ATTACHMENT_INDEXES.filter((idx) => !existingIndexNames.has(idx.name));

    // If tables or indexes are missing, attempt to create them (requires DDL privileges)
    if (!hasMetadata || !hasContents || missingIndexes.length > 0) {
      try {
        if (!hasMetadata) {
          await client.query(`
            CREATE TABLE IF NOT EXISTS attachment_metadata (
              id TEXT PRIMARY KEY,
              claim_id TEXT,
              survey_id TEXT,
              bl_number TEXT,
              cms_reference_number TEXT,
              claim_number TEXT,
              survey_number TEXT,
              mandatory_attachment_type TEXT,
              original_filename TEXT NOT NULL,
              stored_filename TEXT,
              mime_type TEXT NOT NULL,
              file_size INTEGER NOT NULL,
              uploaded_by_id TEXT,
              uploaded_by_name TEXT,
              uploaded_at TEXT NOT NULL,
              comments TEXT,
              document_status TEXT DEFAULT 'uploaded',
              checksum TEXT,
              created_date TEXT NOT NULL
            )
          `);
        }

        if (!hasContents) {
          await client.query(`
            CREATE TABLE IF NOT EXISTS attachment_contents (
              attachment_id TEXT PRIMARY KEY REFERENCES attachment_metadata(id) ON DELETE CASCADE,
              file_data BYTEA NOT NULL
            )
          `);
        }

        for (const idx of missingIndexes) {
          await client.query(idx.sql);
        }
      } catch (ddlErr: any) {
        // DDL execution failed (e.g. 42501 insufficient_privilege for pil_app_user)
        console.error('[PostgreSQL] Attachment schema DDL execution failed:', ddlErr?.message || ddlErr);
      }
    }

    // Post-initialization schema completeness verification
    const finalTableCheck = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('attachment_metadata', 'attachment_contents')
    `);
    const verifiedTables = new Set(finalTableCheck.rows.map((r: any) => r.table_name));
    const missingTables: string[] = [];
    if (!verifiedTables.has('attachment_metadata')) missingTables.push('attachment_metadata');
    if (!verifiedTables.has('attachment_contents')) missingTables.push('attachment_contents');

    if (missingTables.length > 0) {
      const err: any = new Error(
        `[PostgreSQL] Database initialization failed: required attachment tables missing: ${missingTables.join(', ')}. ` +
        `Application cannot start with incomplete attachment schema. ` +
        `Schema DDL must be executed by an administrative user (DB_USER/postgres).`
      );
      err.code = 'ATTACHMENT_SCHEMA_MISSING_TABLES';
      throw err;
    }

    const finalIndexCheck = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'attachment_metadata'
    `);
    const verifiedIndexes = new Set(finalIndexCheck.rows.map((r: any) => r.indexname));
    const stillMissingIndexes = REQUIRED_ATTACHMENT_INDEXES.filter((idx) => !verifiedIndexes.has(idx.name));

    if (stillMissingIndexes.length > 0) {
      const err: any = new Error(
        `[PostgreSQL] Database initialization failed: required attachment search indexes missing: ${stillMissingIndexes.map((i) => i.name).join(', ')}. ` +
        `Application cannot start with incomplete attachment search indexes. ` +
        `Schema DDL must be executed by an administrative user (DB_USER/postgres).`
      );
      err.code = 'ATTACHMENT_SCHEMA_MISSING_INDEXES';
      throw err;
    }

    console.log('[PostgreSQL] Attachment tables and indexes verified (attachment_metadata, attachment_contents).');
  } catch (err: any) {
    console.error('[PostgreSQL] Database initialization failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Test connectivity to PostgreSQL
 */
export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await pool.query('SELECT NOW() as now, current_database() as db');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}

export default pool;
