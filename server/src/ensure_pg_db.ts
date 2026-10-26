import { Client } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Ensures the target PostgreSQL database exists.
 * Connects to the default 'postgres' database and creates DB_NAME if missing.
 */
export async function ensureDatabaseExists(): Promise<boolean> {
  const targetDb = process.env.DB_NAME || 'pil_claims_db';

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
    if (res.rowCount === 0) {
      console.log(`[PostgreSQL] Target database "${targetDb}" not found. Creating...`);
      await client.query(`CREATE DATABASE "${targetDb}"`);
      console.log(`[PostgreSQL] Database "${targetDb}" created successfully.`);
    } else {
      console.log(`[PostgreSQL] Target database "${targetDb}" verified.`);
    }
    return true;
  } catch (err: any) {
    console.warn(`[PostgreSQL Note] Automatic database check on default postgres: ${err.message}`);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  ensureDatabaseExists().then(() => process.exit(0)).catch(() => process.exit(1));
}
