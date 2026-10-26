const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function syncAndTest() {
  // Step 1: Connect as the current DB_USER from .env
  const adminClient = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'pil_claims_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  });

  try {
    await adminClient.connect();
    console.log('Connected to PostgreSQL successfully.');

    // Update pil_app_user password to match DB_PASSWORD in .env
    // Parameterized query: ALTER USER does not accept $1 for password in standard SQL, so use quote_literal
    await adminClient.query(`ALTER USER "pil_app_user" WITH PASSWORD ${adminClient.escapeLiteral(process.env.DB_PASSWORD)}`);
    console.log('Synchronized pil_app_user credentials in PostgreSQL.');

    await adminClient.end();

    // Step 2: Now test connecting directly as pil_app_user using DB_PASSWORD
    const appClient = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'pil_claims_db',
      user: 'pil_app_user',
      password: process.env.DB_PASSWORD,
    });

    await appClient.connect();
    const whoami = await appClient.query('SELECT current_user, current_database()');
    console.log(`Successfully connected as dedicated user: ${whoami.rows[0].current_user} on ${whoami.rows[0].current_database}`);

    // Verify pil_app_user can query claims
    const claimsCheck = await appClient.query('SELECT COUNT(*) FROM claims');
    console.log(`Claims query via pil_app_user: count = ${claimsCheck.rows[0].count}`);

    // Verify pil_app_user CANNOT drop tables (least-privilege test)
    let dropPrevented = false;
    try {
      await appClient.query('DROP TABLE IF EXISTS test_illegal_drop');
    } catch (e) {
      dropPrevented = true;
      console.log('Verified least privilege: pil_app_user cannot perform DDL (DROP TABLE denied)');
    }

    await appClient.end();
    return { success: true };
  } catch (err) {
    console.error('Error:', err.message);
    return { success: false, error: err.message };
  }
}

syncAndTest();
