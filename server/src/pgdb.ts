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

/**
 * Initialize PostgreSQL Schema from pg_schema.sql if needed, or verify existing tables
 */
export async function initPgDatabase() {
  const client = await pool.connect();
  try {
    // 1. Verify if key application tables exist
    const checkRes = await client.query(
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('claims', 'surveys', 'users')"
    );
    const existingCount = parseInt(checkRes.rows[0].count, 10);
    if (existingCount >= 3) {
      console.log('[PostgreSQL] Database tables verified and active.');
      return;
    }

    // 2. Fallback to schema execution if running with DDL privileges
    const schemaPath = path.resolve(__dirname, 'pg_schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf-8');
      await client.query(sql);
      console.log('[PostgreSQL] Schema successfully initialized / verified.');
    }
  } catch (err: any) {
    console.warn('[PostgreSQL] Database initialization note:', err?.message || err);
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
