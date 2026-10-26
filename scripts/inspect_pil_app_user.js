const { Client } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function inspectRoles() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'pil_claims_db',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await client.connect();
    const rolesRes = await client.query(`
      SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin 
      FROM pg_roles 
      WHERE rolname IN ('postgres', 'pil_app_user')
    `);
    console.log('Roles status:');
    for (const r of rolesRes.rows) {
      console.log(`  ${r.rolname}: superuser=${r.rolsuper}, createDb=${r.rolcreatedb}, createRole=${r.rolcreaterole}, canLogin=${r.rolcanlogin}`);
    }

    const privsRes = await client.query(`
      SELECT table_name, privilege_type 
      FROM information_schema.table_privileges 
      WHERE grantee = 'pil_app_user' 
      ORDER BY table_name, privilege_type
    `);
    console.log(`\nTable Privileges for pil_app_user (${privsRes.rows.length} total granted):`);
    const tables = [...new Set(privsRes.rows.map(r => r.table_name))];
    for (const t of tables) {
      const pTypes = privsRes.rows.filter(r => r.table_name === t).map(r => r.privilege_type);
      console.log(`  Table ${t}: [${pTypes.join(', ')}]`);
    }

    // Check schema permissions
    const schemaPrivs = await client.query(`
      SELECT has_schema_privilege('pil_app_user', 'public', 'USAGE') as can_use,
             has_schema_privilege('pil_app_user', 'public', 'CREATE') as can_create,
             has_database_privilege('pil_app_user', current_database(), 'CONNECT') as can_connect,
             has_database_privilege('pil_app_user', current_database(), 'CREATE') as can_createdb
    `);
    console.log('\nDatabase/Schema privileges for pil_app_user:');
    console.log(`  CONNECT: ${schemaPrivs.rows[0].can_connect}`);
    console.log(`  DATABASE CREATE: ${schemaPrivs.rows[0].can_createdb}`);
    console.log(`  SCHEMA USAGE: ${schemaPrivs.rows[0].can_use}`);
    console.log(`  SCHEMA CREATE: ${schemaPrivs.rows[0].can_create}`);

  } catch (err) {
    console.error('Error inspecting:', err.message);
  } finally {
    await client.end();
  }
}

inspectRoles();
