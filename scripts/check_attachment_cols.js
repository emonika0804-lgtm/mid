const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function checkCols() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'pil_claims_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  });

  await client.connect();
  const colsMeta = await client.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'attachment_metadata' ORDER BY ordinal_position");
  console.log('attachment_metadata columns:');
  console.table(colsMeta.rows);

  const colsCont = await client.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'attachment_contents' ORDER BY ordinal_position");
  console.log('attachment_contents columns:');
  console.table(colsCont.rows);

  await client.end();
}

checkCols();
