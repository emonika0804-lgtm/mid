const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function check() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'pil_claims_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  });

  await client.connect();
  const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log('Tables in pil_claims_db:', res.rows.map(r => r.table_name));

  const privs = await client.query("SELECT grantee, privilege_type, table_name FROM information_schema.table_privileges WHERE grantee = 'pil_app_user' AND table_name LIKE 'attachment%'");
  console.log('pil_app_user privileges on attachment tables:', privs.rows);

  await client.end();
}

check();
