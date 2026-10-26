import pool from '../server/src/pgdb';
import fs from 'fs';
import path from 'path';

async function inspectAttachments() {
  const uploadsDir = path.resolve('uploads');
  const files = fs.readdirSync(uploadsDir);
  console.log('Files on disk:', files.length);

  for (const f of files) {
    const claims = await pool.query(
      'SELECT id, claim_number, created_by_name FROM claims WHERE attachments LIKE $1 OR email_thread LIKE $1 OR court_case_file_attachment LIKE $1',
      [`%${f}%`]
    );
    const surveys = await pool.query(
      'SELECT id, survey_number, created_by_name FROM surveys WHERE attachments LIKE $1',
      [`%${f}%`]
    );
    const uploads = await pool.query('SELECT * FROM file_uploads WHERE filename = $1', [f]);
    console.log(`${f} -> claims: [${claims.rows.map(r => r.claim_number).join(', ')}] | surveys: [${surveys.rows.map(r => r.survey_number).join(', ')}] | staging: ${uploads.rows.length ? 'yes' : 'no'}`);
  }
  await pool.end();
}

inspectAttachments();
