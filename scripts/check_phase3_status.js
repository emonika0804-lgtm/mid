const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function inspectPhase3() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'pil_claims_db',
    user: 'pil_app_user',
    password: process.env.DB_PASSWORD,
  });

  try {
    await client.connect();
    const whoami = await client.query('SELECT current_user, current_database()');

    // 1. Check table existence
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('attachment_metadata', 'attachment_contents')
    `);
    const existingTables = tablesRes.rows.map(r => r.table_name);

    // 2. Count records in tables
    let metaCount = 0;
    let contCount = 0;
    if (existingTables.includes('attachment_metadata')) {
      const res = await client.query('SELECT COUNT(*) FROM attachment_metadata');
      metaCount = parseInt(res.rows[0].count, 10);
    }
    if (existingTables.includes('attachment_contents')) {
      const res = await client.query('SELECT COUNT(*) FROM attachment_contents');
      contCount = parseInt(res.rows[0].count, 10);
    }

    // 3. Inspect uploads/ directory
    const uploadsDir = path.resolve(__dirname, '../uploads');
    const diskFiles = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];

    console.log(JSON.stringify({
      currentUser: whoami.rows[0].current_user,
      database: whoami.rows[0].current_database,
      attachmentMetadataExists: existingTables.includes('attachment_metadata'),
      attachmentContentsExists: existingTables.includes('attachment_contents'),
      metadataCount: metaCount,
      contentsCount: contCount,
      diskFilesCount: diskFiles.length,
      diskFiles: diskFiles
    }, null, 2));

  } catch (err) {
    console.error('Inspection error:', err.message);
  } finally {
    await client.end();
  }
}

inspectPhase3();
