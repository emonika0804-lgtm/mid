import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import http from 'http';
import path from 'path';
import fs from 'fs';

const JWT_SECRET = process.env.JWT_SECRET || 'pil-cargo-claims-secret-key-2026';
const PORT = 5000;
const HOST = '127.0.0.1';

// Direct HTTP helper
function makeRequest(
  method: string,
  reqPath: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: reqPath,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('   PHASE 2A SECURITY VERIFICATION TEST SUITE (REV 2)');
  console.log('====================================================\n');

  const dbPath = path.resolve(__dirname, '../../pil_claims.db');
  const db = new Database(dbPath);

  // Generate test JWTs
  const adminToken = jwt.sign(
    { id: 'usr-admin-01', email: 'admin@pilship.com', full_name: 'System Administrator', role: 'admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const midToken = jwt.sign(
    { id: 'usr-mid-01', email: 'mid@pilship.com', full_name: 'Alfred Tan', role: 'mid' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const agency1Token = jwt.sign(
    { id: 'usr-agency-01', email: 'agency@pilship.com', full_name: 'Singapore Port Agency', role: 'agency' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const agency2Token = jwt.sign(
    { id: 'usr-agency-02', email: 'agency2@pilship.com', full_name: 'Dubai Agency Rep', role: 'agency' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // An unverified user
  db.prepare(`
    INSERT OR REPLACE INTO users (id, created_date, updated_date, full_name, email, password_hash, role, is_verified)
    VALUES ('usr-unverified', '2026-10-21T00:00:00Z', '2026-10-21T00:00:00Z', 'Unverified User', 'unverified@test.com', 'hash', 'agency', 0)
  `).run();

  const unverifiedToken = jwt.sign(
    { id: 'usr-unverified', email: 'unverified@test.com', full_name: 'Unverified User', role: 'agency' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Known test files
  const adminFile = 'Screenshot_2026-03-05_093701-1791881428572-701750407.png'; // attached to CLM-2026-0002 (created by admin)
  const agency1File = 'Screenshot_2026-03-05_093701-1791882884218-734933680.png'; // attached to CLM-2026-0003 (created by agency1)

  // Create an unlinked draft file for testing draft access
  const uploadsDir = path.resolve(__dirname, '../../uploads');
  const draftFilename = 'draft_test_doc_unlinked.txt';
  const draftFilePath = path.resolve(uploadsDir, draftFilename);
  fs.writeFileSync(draftFilePath, 'CONFIDENTIAL DRAFT CONTENT BY AGENCY 1');

  // Register in file_uploads staging table as uploaded by agency1, but NOT attached to any claim or survey
  db.prepare(`
    INSERT OR REPLACE INTO file_uploads (filename, original_filename, mime_type, file_size, uploaded_by_id, uploaded_by_name, uploaded_at)
    VALUES (?, ?, 'text/plain', 38, 'usr-agency-01', 'Singapore Port Agency', '2026-10-21T15:00:00Z')
  `).run(draftFilename, 'draft_test_doc_unlinked.txt');

  const results: { name: string; passed: boolean; details: string }[] = [];

  function record(name: string, passed: boolean, details: string) {
    results.push({ name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${mark}: ${name} (${details})`);
  }

  try {
    // TEST 1: Unauthenticated request to /uploads/:filename
    const t1 = await makeRequest('GET', `/uploads/${adminFile}`);
    record(
      'Unauthenticated access to /uploads/:filename is blocked',
      t1.status === 401,
      `HTTP status: ${t1.status} (expected 401)`
    );

    // TEST 2: Unauthenticated request to /api/files/:filename
    const t2 = await makeRequest('GET', `/api/files/${adminFile}`);
    record(
      'Unauthenticated access to /api/files/:filename is blocked',
      t2.status === 401,
      `HTTP status: ${t2.status} (expected 401)`
    );

    // TEST 3: Path traversal attempt with ../
    const t3 = await makeRequest('GET', '/api/files/..%2f..%2fpackage.json', {
      Authorization: `Bearer ${adminToken}`,
    });
    record(
      'Path traversal attempt blocked with 400 Bad Request',
      t3.status === 400,
      `HTTP status: ${t3.status} (expected 400)`
    );

    // TEST 4: Non-existent document request
    const t4 = await makeRequest('GET', '/api/files/non_existent_document_9999.png', {
      Authorization: `Bearer ${adminToken}`,
    });
    record(
      'Non-existent document returns 404',
      t4.status === 404,
      `HTTP status: ${t4.status} (expected 404)`
    );

    // TEST 5: Unlinked file without upload record (acer.lnk)
    const t5 = await makeRequest('GET', '/api/files/acer.lnk', {
      Authorization: `Bearer ${agency1Token}`,
    });
    record(
      'Unlinked, unverified file access blocked',
      t5.status === 404 || t5.status === 403,
      `HTTP status: ${t5.status} (expected 404 or 403)`
    );

    // TEST 6: Admin user downloading Admin's document
    const t6 = await makeRequest('GET', `/api/files/${adminFile}`, {
      Authorization: `Bearer ${adminToken}`,
    });
    record(
      'Admin successfully downloads existing document',
      t6.status === 200 && t6.headers['content-type'] === 'image/png',
      `HTTP status: ${t6.status}, content-type: ${t6.headers['content-type']}`
    );

    // TEST 7: MID user downloading document
    const t7 = await makeRequest('GET', `/api/files/${adminFile}`, {
      Authorization: `Bearer ${midToken}`,
    });
    record(
      'MID user successfully downloads document',
      t7.status === 200,
      `HTTP status: ${t7.status} (expected 200)`
    );

    // TEST 8: Agency 1 downloading their OWN attached document (CLM-2026-0003)
    const t8 = await makeRequest('GET', `/api/files/${agency1File}`, {
      Authorization: `Bearer ${agency1Token}`,
    });
    record(
      'Agency 1 successfully downloads document from their own claim',
      t8.status === 200,
      `HTTP status: ${t8.status} (expected 200)`
    );

    // TEST 9: Cross-agency access attempt: Agency 2 attempting to download Agency 1's attached document
    const t9 = await makeRequest('GET', `/api/files/${agency1File}`, {
      Authorization: `Bearer ${agency2Token}`,
    });
    record(
      'Cross-Agency access blocked: Agency 2 cannot access Agency 1 document',
      t9.status === 403,
      `HTTP status: ${t9.status} (expected 403 Forbidden)`
    );

    // TEST 10: Agency 1 attempting to download Admin's document (CLM-2026-0002)
    const t10 = await makeRequest('GET', `/api/files/${adminFile}`, {
      Authorization: `Bearer ${agency1Token}`,
    });
    record(
      'Agency cannot access document of another record created by Admin',
      t10.status === 403,
      `HTTP status: ${t10.status} (expected 403 Forbidden)`
    );

    // TEST 11 (SECURITY CHECK 1): URL Query Parameter Token (?token=...) MUST BE REJECTED
    const t11 = await makeRequest('GET', `/api/files/${adminFile}?token=${adminToken}`);
    record(
      'URL query parameter authentication (?token=...) is strictly rejected with 401',
      t11.status === 401,
      `HTTP status: ${t11.status} (expected 401 Unauthorized)`
    );

    // TEST 12: Access with unverified user account
    const t12 = await makeRequest('GET', `/api/files/${adminFile}`, {
      Authorization: `Bearer ${unverifiedToken}`,
    });
    record(
      'Unverified user account blocked with 403',
      t12.status === 403,
      `HTTP status: ${t12.status} (expected 403)`
    );

    // TEST 13: Invalid / malformed JWT token
    const t13 = await makeRequest('GET', `/api/files/${adminFile}`, {
      Authorization: 'Bearer invalid.token.value',
    });
    record(
      'Malformed token blocked with 401',
      t13.status === 401,
      `HTTP status: ${t13.status} (expected 401)`
    );

    // TEST 14 (SECURITY CHECK 2A): Agency user CANNOT access a document attached to Admin claim,
    // EVEN IF Agency user is set as the original uploader in file_uploads!
    db.prepare(`
      INSERT OR REPLACE INTO file_uploads (filename, original_filename, mime_type, file_size, uploaded_by_id, uploaded_by_name, uploaded_at)
      VALUES (?, 'admin_doc.png', 'image/png', 27836, 'usr-agency-01', 'Singapore Port Agency', '2026-10-21T15:00:00Z')
    `).run(adminFile);

    const t14 = await makeRequest('GET', `/api/files/${adminFile}`, {
      Authorization: `Bearer ${agency1Token}`,
    });
    record(
      'Agency user blocked from attached document on Admin claim EVEN IF they uploaded it',
      t14.status === 403,
      `HTTP status: ${t14.status} (expected 403 Forbidden)`
    );

    // TEST 15 (SECURITY CHECK 2B): Legitimate access to own UNLINKED draft upload IS preserved
    const t15 = await makeRequest('GET', `/api/files/${draftFilename}`, {
      Authorization: `Bearer ${agency1Token}`,
    });
    record(
      'Legitimate access to own unlinked draft upload is preserved for uploader',
      t15.status === 200,
      `HTTP status: ${t15.status} (expected 200 OK)`
    );

    // TEST 16 (SECURITY CHECK 2C): Another Agency user CANNOT access Agency 1 unlinked draft upload
    const t16 = await makeRequest('GET', `/api/files/${draftFilename}`, {
      Authorization: `Bearer ${agency2Token}`,
    });
    record(
      'Other Agency user cannot access Agency 1 unlinked draft upload',
      t16.status === 403,
      `HTTP status: ${t16.status} (expected 403 Forbidden)`
    );

    // CLEANUP
    db.prepare("DELETE FROM users WHERE id = 'usr-unverified'").run();
    db.prepare("DELETE FROM file_uploads WHERE filename = ?").run(draftFilename);
    db.prepare("DELETE FROM file_uploads WHERE filename = ?").run(adminFile);
    if (fs.existsSync(draftFilePath)) {
      fs.unlinkSync(draftFilePath);
    }

    console.log('\n====================================================');
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = total - passed;
    console.log(`TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('====================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

runTests();
