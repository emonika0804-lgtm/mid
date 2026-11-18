import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TEST_DB_NAME = 'pil_claims_test_db';

export function getTestDbConfig(asAdmin: boolean = false) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: TEST_DB_NAME,
    user: asAdmin
      ? (process.env.DB_USER || 'postgres')
      : (process.env.DB_APP_USER || 'pil_app_user'),
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

/**
 * Creates and initializes the isolated PostgreSQL test database: pil_claims_test_db
 * NEVER touches or alters the production database pil_claims_db.
 */
export async function setupIsolatedTestDb(): Promise<void> {
  console.log(`[TestDbSetup] Ensuring isolated test database "${TEST_DB_NAME}" exists...`);

  // 1. Connect to default 'postgres' database to create test database if needed
  const rootClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await rootClient.connect();

  try {
    const checkRes = await rootClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [TEST_DB_NAME]
    );

    if (checkRes.rows.length === 0) {
      console.log(`[TestDbSetup] Creating new database "${TEST_DB_NAME}"...`);
      await rootClient.query(`CREATE DATABASE ${TEST_DB_NAME}`);
      console.log(`[TestDbSetup] Database "${TEST_DB_NAME}" created.`);
    } else {
      console.log(`[TestDbSetup] Database "${TEST_DB_NAME}" verified.`);
    }
  } finally {
    await rootClient.end();
  }

  // 2. Connect to pil_claims_test_db as admin to initialize schema
  const adminClient = new Client(getTestDbConfig(true));
  await adminClient.connect();

  try {
    // 2.1 Load core base schema
    const schemaPath = path.resolve(__dirname, '../server/src/pg_schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sql = fs.readFileSync(schemaPath, 'utf-8');
      await adminClient.query(sql);
    }

    // 2.2 Load Phase 4 attachment search indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_bl_number ON attachment_metadata(bl_number)',
      'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_claim_number ON attachment_metadata(claim_number)',
      'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_survey_number ON attachment_metadata(survey_number)',
      'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_cms_number ON attachment_metadata(cms_reference_number)',
      'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_type ON attachment_metadata(mandatory_attachment_type)',
      'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_uploaded_by_id ON attachment_metadata(uploaded_by_id)',
      'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_uploaded_at ON attachment_metadata(uploaded_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_original_filename ON attachment_metadata(original_filename)',
      'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_claim_id ON attachment_metadata(claim_id)',
      'CREATE INDEX IF NOT EXISTS idx_attachment_metadata_survey_id ON attachment_metadata(survey_id)',
    ];
    for (const idx of indexes) {
      await adminClient.query(idx);
    }

    // 2.3 Load Phase 6 schema & columns
    await adminClient.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE IF NOT EXISTS user_otps (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        otp_hash VARCHAR(128) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        resend_available_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        is_used BOOLEAN NOT NULL DEFAULT FALSE,
        used_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_user_otps_email_active ON user_otps(email, is_used, expires_at);
      CREATE INDEX IF NOT EXISTS idx_user_otps_user_id ON user_otps(user_id);

      CREATE TABLE IF NOT EXISTS password_resets (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        token_hash VARCHAR(128) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        is_used BOOLEAN NOT NULL DEFAULT FALSE,
        used_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON password_resets(token_hash);
      CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

      CREATE TABLE IF NOT EXISTS email_logs (
        id VARCHAR(64) PRIMARY KEY,
        recipient VARCHAR(255) NOT NULL,
        subject VARCHAR(500) NOT NULL,
        template_type VARCHAR(64) NOT NULL,
        delivery_status VARCHAR(64) NOT NULL,
        provider VARCHAR(64) NOT NULL,
        error_message TEXT,
        reference_id VARCHAR(128),
        reference_type VARCHAR(64),
        attachments_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient);
      CREATE INDEX IF NOT EXISTS idx_email_logs_ref ON email_logs(reference_id, reference_type);
      CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);

      CREATE TABLE IF NOT EXISTS auth_audit_logs (
        id VARCHAR(64) PRIMARY KEY,
        event_type VARCHAR(64) NOT NULL,
        user_id VARCHAR(64),
        email VARCHAR(255) NOT NULL,
        ip_address VARCHAR(128),
        user_agent TEXT,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_email ON auth_audit_logs(email);
      CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_user_id ON auth_audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_event ON auth_audit_logs(event_type);
      CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_created_at ON auth_audit_logs(created_at DESC);
    `);

    // 2.4 Grant all permissions to runtime user pil_app_user
    await adminClient.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pil_app_user;
    `);

    // 2.5 Seed standard test users if missing
    const userCheck = await adminClient.query(`SELECT COUNT(*) FROM users`);
    if (parseInt(userCheck.rows[0].count, 10) === 0) {
      const defaultPasswordHash = bcrypt.hashSync('Password123!', 10);
      const now = new Date().toISOString();
      const testSeedUsers = [
        ['usr-admin', now, now, 'PIL Admin', 'admin@pilship.com', defaultPasswordHash, 'admin', 1],
        ['usr-mid', now, now, 'PIL Claims Handler', 'mid@pilship.com', defaultPasswordHash, 'mid', 1],
        ['usr-gcc', now, now, 'PIL GCC Team', 'gcc@pilship.com', defaultPasswordHash, 'mid_gcc', 1],
        ['usr-agency', now, now, 'PIL Port Agency 1', 'agency@pilship.com', defaultPasswordHash, 'agency', 1],
        ['usr-agency2', now, now, 'PIL Port Agency 2', 'agency2@pilship.com', defaultPasswordHash, 'agency', 1],
      ];

      for (const u of testSeedUsers) {
        await adminClient.query(`
          INSERT INTO users (id, created_date, updated_date, full_name, email, password_hash, role, is_verified, token_version)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
          ON CONFLICT (email) DO NOTHING
        `, u);
      }
      console.log('[TestDbSetup] Seeded 5 standard test user accounts in pil_claims_test_db.');
    }

    console.log(`[TestDbSetup] Isolated test database "${TEST_DB_NAME}" initialized successfully.`);
  } finally {
    await adminClient.end();
  }
}

/**
 * Resets test data in pil_claims_test_db without dropping tables
 */
export async function cleanTestDb(): Promise<void> {
  const adminClient = new Client(getTestDbConfig(true));
  await adminClient.connect();
  try {
    // Truncate business tables, preserving default seed users
    await adminClient.query(`
      TRUNCATE TABLE claims, surveys, attachment_contents, attachment_metadata,
                     expenses, recoveries, notifications, user_otps, password_resets,
                     email_logs, auth_audit_logs, audit_logs CASCADE;
    `);
    console.log('[TestDbSetup] Cleaned isolated test database records.');
  } finally {
    await adminClient.end();
  }
}

if (require.main === module) {
  setupIsolatedTestDb()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Failed to setup isolated test database:', err);
      process.exit(1);
    });
}
