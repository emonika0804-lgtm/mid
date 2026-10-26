const { Client } = require('pg');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function setupLeastPrivilegeUser() {
  console.log('===========================================================');
  console.log('  Provisioning Dedicated Least-Privilege PostgreSQL User');
  console.log('===========================================================\n');

  const adminClient = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  const appUsername = 'pil_app_user';
  // Generate a cryptographically secure random password
  const appPassword = crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, 'X');

  try {
    await adminClient.connect();
    console.log('Connected to PostgreSQL as admin.');

    // 1. Create or update user
    const userExists = await adminClient.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [appUsername]
    );

    if (userExists.rowCount === 0) {
      console.log(`Creating user "${appUsername}"...`);
      await adminClient.query(`CREATE USER "${appUsername}" WITH PASSWORD '${appPassword}'`);
      console.log(`✅ User "${appUsername}" created.`);
    } else {
      console.log(`User "${appUsername}" already exists; updating password...`);
      await adminClient.query(`ALTER USER "${appUsername}" WITH PASSWORD '${appPassword}'`);
      console.log(`✅ User "${appUsername}" password updated.`);
    }

    // Connect to the target database to grant permissions
    await adminClient.end();

    const targetDbClient = new Client({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'pil_claims_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });

    await targetDbClient.connect();
    console.log(`Connected to target database "${process.env.DB_NAME || 'pil_claims_db'}".`);

    // Grant least-privilege permissions: only DML on application tables, NO superuser, NO createdb
    await targetDbClient.query(`GRANT CONNECT ON DATABASE "${process.env.DB_NAME || 'pil_claims_db'}" TO "${appUsername}"`);
    await targetDbClient.query(`GRANT USAGE ON SCHEMA public TO "${appUsername}"`);
    await targetDbClient.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appUsername}"`);
    await targetDbClient.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appUsername}"`);
    await targetDbClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appUsername}"`);
    await targetDbClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${appUsername}"`);

    console.log(`✅ Granted CONNECT, USAGE, SELECT, INSERT, UPDATE, DELETE to "${appUsername}".`);
    console.log(`✅ Least-privilege configuration successfully applied.\n`);

    console.log('To switch your .env to this dedicated user whenever desired:');
    console.log(`  DB_USER=${appUsername}`);
    console.log(`  DB_PASSWORD=${appPassword}\n`);

    await targetDbClient.end();
  } catch (err) {
    console.error('Least privilege user setup error:', err.message);
  }
}

setupLeastPrivilegeUser();
