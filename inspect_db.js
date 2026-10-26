const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.resolve(__dirname, 'pil_claims.db'));

console.log('--- CLAIMS TABLE ---');
const claims = db.prepare('SELECT id, claim_number, attachments FROM claims').all();
claims.forEach(c => {
  console.log(`Claim ID: ${c.id} | Claim Number: ${c.claim_number}`);
  try {
    const parsed = JSON.parse(c.attachments || '[]');
    console.log('Attachments Metadata:');
    console.dir(parsed, { depth: null });
  } catch (e) {
    console.log('Raw attachments:', c.attachments);
  }
  console.log('---------------------------');
});

console.log('\n--- SURVEYS TABLE ---');
const surveys = db.prepare('SELECT id, survey_number, attachments FROM surveys').all();
surveys.forEach(s => {
  console.log(`Survey ID: ${s.id} | Survey Number: ${s.survey_number}`);
  try {
    const parsed = JSON.parse(s.attachments || '[]');
    console.log('Attachments Metadata:');
    console.dir(parsed, { depth: null });
  } catch (e) {
    console.log('Raw attachments:', s.attachments);
  }
  console.log('---------------------------');
});
