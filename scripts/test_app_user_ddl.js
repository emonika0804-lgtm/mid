const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function testSchemaAsAppUser() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'pil_claims_db',
    user: 'pil_app_user',
    password: process.env.DB_PASSWORD,
  });

  try {
    await client.connect();
    const schemaSql = fs.readFileSync(path.resolve(__dirname, '../server/src/pg_schema.sql'), 'utf-8');
    await client.query(schemaSql);
    console.log('Success: pil_app_user can verify schema.');
  } catch (err) {
    console.log('Result for schema DDL as pil_app_user:', err.message);
  } finally {
    await client.end();
  }
}

testSchemaAsAppUser();
