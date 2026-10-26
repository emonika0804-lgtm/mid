import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { pool, query, initDatabase } from './db';
import { loadLMSExcel, fetchLMSByBL } from './lms';
import { getDailyExchangeRates } from './rates';
import {
  login,
  register,
  verifyOtp,
  forgotPassword,
  resetPassword,
  googleAuth,
  getCurrentUser,
  authenticate,
} from './auth';
import claimsRouter from './routes/claims';
import surveysRouter from './routes/surveys';
import dashboardRouter from './routes/dashboard';
import usersRouter from './routes/users';
import uploadsRouter from './routes/uploads';
import filesRouter from './routes/files';
import db from './db';

const TEST_PORT = 5060;
const BASE_URL = `http://localhost:${TEST_PORT}`;

function createExpressApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));

  app.use('/api/files', filesRouter);
  app.use('/uploads', filesRouter);

  app.post('/api/auth/login', login);
  app.post('/api/auth/register', register);
  app.post('/api/auth/verify-otp', verifyOtp);
  app.post('/api/auth/forgot-password', forgotPassword);
  app.post('/api/auth/reset-password', resetPassword);
  app.post('/api/auth/google', googleAuth);
  app.get('/api/auth/me', authenticate, getCurrentUser);

  app.get('/api/lms/lookup', authenticate, async (req, res) => {
    const blNumber = req.query.bl_number as string;
    if (!blNumber) {
      return res.status(400).json({ error: 'bl_number parameter is required' });
    }
    const result = await fetchLMSByBL(blNumber);
    if (result.error) {
      return res.status(404).json({ error: result.error });
    }
    return res.json(result);
  });

  app.get('/api/rates', authenticate, async (_req, res) => {
    const result = await getDailyExchangeRates();
    return res.json(result);
  });

  app.get('/api/notifications', authenticate, async (req: any, res) => {
    const user = req.user;
    const rows = await db.prepare('SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_date DESC LIMIT 50').all(user.id);
    return res.json(rows);
  });

  app.put('/api/notifications/:id/read', authenticate, async (req, res) => {
    await db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
    return res.json({ success: true });
  });

  app.use('/api/claims', claimsRouter);
  app.use('/api/surveys', surveysRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/upload', uploadsRouter);

  return app;
}

interface TestResult {
  category: string;
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function recordTest(category: string, name: string, passed: boolean, details?: string) {
  results.push({ category, name, passed, details });
  const status = passed ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${status}: [${category}] ${name}${details ? ` (${details})` : ''}`);
}

async function runFinalVerification() {
  console.log('========================================================================');
  console.log('   PIL CARGO CLAIMS - FINAL POSTGRESQL BACKEND VERIFICATION SUITE');
  console.log('========================================================================\n');

  await initDatabase();
  loadLMSExcel();

  try {
    // -------------------------------------------------------------------------
    // 1. Confirm Application Runtime Uses Dedicated pil_app_user
    // -------------------------------------------------------------------------
    console.log('1. RUNTIME USER VERIFICATION');
    const runtimeUserCheck = await pool.query('SELECT current_user, current_database(), session_user');
    const activeUser = runtimeUserCheck.rows[0].current_user;
    const isAppUser = activeUser === 'pil_app_user';
    const isNotSuperuser = activeUser !== 'postgres';
    recordTest('Runtime User', 'Runtime connected as pil_app_user', isAppUser, `Current user: ${activeUser}`);
    recordTest('Runtime User', 'Runtime NOT using postgres superuser', isNotSuperuser, `Active session: ${activeUser}`);

    // -------------------------------------------------------------------------
    // 2. Verify pil_app_user Least-Privilege Permissions
    // -------------------------------------------------------------------------
    console.log('\n2. LEAST-PRIVILEGE PERMISSION VERIFICATION');
    const roleRes = await pool.query(`
      SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin 
      FROM pg_roles 
      WHERE rolname = 'pil_app_user'
    `);
    const role = roleRes.rows[0];
    recordTest('Permissions', 'pil_app_user is NOT a superuser (rolsuper=false)', role.rolsuper === false);
    recordTest('Permissions', 'pil_app_user cannot create databases (rolcreatedb=false)', role.rolcreatedb === false);
    recordTest('Permissions', 'pil_app_user cannot create roles (rolcreaterole=false)', role.rolcreaterole === false);

    // Schema level permissions
    const schemaPrivs = await pool.query(`
      SELECT has_schema_privilege('pil_app_user', 'public', 'USAGE') as can_use,
             has_schema_privilege('pil_app_user', 'public', 'CREATE') as can_create,
             has_database_privilege('pil_app_user', current_database(), 'CONNECT') as can_connect,
             has_database_privilege('pil_app_user', current_database(), 'CREATE') as can_createdb
    `);
    recordTest('Permissions', 'pil_app_user has database CONNECT privilege', schemaPrivs.rows[0].can_connect === true);
    recordTest('Permissions', 'pil_app_user has schema USAGE privilege', schemaPrivs.rows[0].can_use === true);
    recordTest('Permissions', 'pil_app_user denied database CREATE privilege', schemaPrivs.rows[0].can_createdb === false);
    recordTest('Permissions', 'pil_app_user denied schema CREATE privilege (no DDL)', schemaPrivs.rows[0].can_create === false);

    // Attempt unauthorized DDL as pil_app_user
    let ddlBlocked = false;
    try {
      await pool.query('CREATE TABLE IF NOT EXISTS test_unauthorized_table (id INT)');
    } catch (e: any) {
      ddlBlocked = e.message.includes('permission denied');
    }
    recordTest('Permissions', 'DDL operation (CREATE TABLE) strictly denied by PostgreSQL engine', ddlBlocked);

    // -------------------------------------------------------------------------
    // 3. Verify Existing Records, Backups, and Files Preserved
    // -------------------------------------------------------------------------
    console.log('\n3. DATA & BACKUP PRESERVATION VERIFICATION');
    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    recordTest('Data Preservation', 'All 6 users preserved in PostgreSQL', parseInt(usersCount.rows[0].count, 10) === 6);

    const realUser = await pool.query('SELECT id, email, full_name, role FROM users WHERE email = $1', ['yashwanthsakthivel@gmail.com']);
    recordTest('Data Preservation', 'Real user yashwanthsakthivel@gmail.com preserved with MID role', realUser.rows.length === 1 && realUser.rows[0].role === 'mid');

    const claimsCount = await pool.query('SELECT COUNT(*) FROM claims');
    recordTest('Data Preservation', 'All 4 original claims preserved in PostgreSQL', parseInt(claimsCount.rows[0].count, 10) === 4);

    const surveysCount = await pool.query('SELECT COUNT(*) FROM surveys');
    recordTest('Data Preservation', 'Original survey SVY-2026-0001 preserved in PostgreSQL', parseInt(surveysCount.rows[0].count, 10) === 1);

    const auditCount = await pool.query('SELECT COUNT(*) FROM audit_logs');
    recordTest('Data Preservation', 'All 12 original audit log entries preserved in PostgreSQL', parseInt(auditCount.rows[0].count, 10) === 12);

    // Backups check
    const backupDir = path.resolve(__dirname, '../../');
    const backup1Exists = fs.existsSync(path.join(backupDir, 'pil_claims_BACKUP_20261021.db'));
    const backup2Exists = fs.existsSync(path.join(backupDir, 'pil_claims_BACKUP_20261022.db'));
    recordTest('Data Preservation', 'SQLite backup 20261021 verified on disk', backup1Exists);
    recordTest('Data Preservation', 'SQLite backup 20261022 verified on disk', backup2Exists);

    // Uploaded files check
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    const filesOnDisk = fs.readdirSync(uploadsDir);
    recordTest('Data Preservation', 'Uploaded files preserved on disk', filesOnDisk.length >= 9, `${filesOnDisk.length} files found`);

    // -------------------------------------------------------------------------
    // 4. Start Server Instance 1: Create Claims & Surveys
    // -------------------------------------------------------------------------
    console.log('\n4. CREATION & PERSISTENCE TO POSTGRESQL');
    let app = createExpressApp();
    let server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    let currentPort = (server.address() as any).port;
    let currentBaseUrl = `http://127.0.0.1:${currentPort}`;

    // Login Agency 1
    const agency1Res = await fetch(`${currentBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'agency@pilship.com', password: 'Password123!' }),
    });
    const agency1 = await agency1Res.json() as any;
    const agency1Token = agency1.token;

    // Login Agency 2
    const agency2Res = await fetch(`${currentBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'agency2@pilship.com', password: 'Password123!' }),
    });
    const agency2 = await agency2Res.json() as any;
    const agency2Token = agency2.token;

    // Create Claim
    const claimRes = await fetch(`${currentBaseUrl}/api/claims`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agency1Token}`,
      },
      body: JSON.stringify({
        bl_number: 'PIL0100001',
        claimant: 'Verification Global Logistics',
        claimant_type: 'Shipper',
        claim_amount: 14250.75,
        incident_description: 'Pre-restart persistence test claim.',
      }),
    });
    const newClaim = await claimRes.json() as any;
    recordTest('Creation & Persistence', 'Claim created via API', claimRes.status === 201 && newClaim.id);

    // Direct PostgreSQL validation of claim
    const claimPg = await pool.query('SELECT * FROM claims WHERE id = $1', [newClaim.id]);
    recordTest('Creation & Persistence', 'Claim verified directly in PostgreSQL claims table', claimPg.rows.length === 1);
    recordTest('Creation & Persistence', 'Claim BL number and amount match in PostgreSQL', claimPg.rows[0].bl_number === 'PIL0100001' && parseFloat(claimPg.rows[0].claim_amount) === 14250.75);

    // Create Survey
    const surveyRes = await fetch(`${currentBaseUrl}/api/surveys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agency1Token}`,
      },
      body: JSON.stringify({
        bl_number: 'PIL0100002',
        survey_reference_number: 'SRV-VERIF-001',
        survey_requested_by: 'Verification Cargo Surveyors',
        date_of_survey: '2026-10-23',
        survey_cost: 2800.0,
      }),
    });
    const newSurvey = await surveyRes.json() as any;
    recordTest('Creation & Persistence', 'Survey created via API', surveyRes.status === 201 && newSurvey.id);

    // Direct PostgreSQL validation of survey
    const surveyPg = await pool.query('SELECT * FROM surveys WHERE id = $1', [newSurvey.id]);
    recordTest('Creation & Persistence', 'Survey verified directly in PostgreSQL surveys table', surveyPg.rows.length === 1);

    // -------------------------------------------------------------------------
    // 5. Test Persistence After Backend Restart & Frontend Refresh
    // -------------------------------------------------------------------------
    console.log('\n5. BACKEND RESTART & FRONTEND REFRESH SIMULATION');
    // Shutdown server instance 1
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log('  [Simulation] Backend server stopped.');

    // Restart server instance 2 (simulates full service restart)
    app = createExpressApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    currentPort = (server.address() as any).port;
    currentBaseUrl = `http://127.0.0.1:${currentPort}`;
    console.log(`  [Simulation] Backend server restarted on port ${currentPort}.`);

    // Simulate Frontend Refresh: page reload causes client to call /api/auth/me and reload records
    const meAfterRestart = await fetch(`${currentBaseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${agency1Token}` },
    });
    const meAfterData = await meAfterRestart.json() as any;
    recordTest('Persistence & Restart', 'Frontend session revalidation (/api/auth/me) succeeds after backend restart', meAfterRestart.status === 200 && meAfterData.user.id === agency1.user.id);

    // Fetch created Claim after restart
    const claimAfterRestart = await fetch(`${currentBaseUrl}/api/claims/${newClaim.id}`, {
      headers: { Authorization: `Bearer ${agency1Token}` },
    });
    const claimAfterData = await claimAfterRestart.json() as any;
    recordTest('Persistence & Restart', 'Newly created Claim persists and loads after backend restart', claimAfterRestart.status === 200 && claimAfterData.claim_number === newClaim.claim_number);

    // Fetch created Survey after restart
    const surveyAfterRestart = await fetch(`${currentBaseUrl}/api/surveys/${newSurvey.id}`, {
      headers: { Authorization: `Bearer ${agency1Token}` },
    });
    const surveyAfterData = await surveyAfterRestart.json() as any;
    recordTest('Persistence & Restart', 'Newly created Survey persists and loads after backend restart', surveyAfterRestart.status === 200 && surveyAfterData.survey_number === newSurvey.survey_number);

    // -------------------------------------------------------------------------
    // 6. Phase 2A Authenticated Document Access Protections & Cross-Agency RLS
    // -------------------------------------------------------------------------
    console.log('\n6. DOCUMENT ACCESS & CROSS-AGENCY PROTECTION VERIFICATION');

    // Pick a real file from disk that is attached to CLM-2026-0001 (owned by mid or admin)
    const existingClaim1 = await pool.query("SELECT * FROM claims WHERE claim_number = 'CLM-2026-0001'");
    const attachments1 = JSON.parse(existingClaim1.rows[0].attachments || '[]');
    const sampleAttachment = attachments1[0];
    const sampleFilename = sampleAttachment ? path.basename(sampleAttachment.file_url) : filesOnDisk[0];

    // Check 1: Unauthenticated request must return 401
    const unauthRes = await fetch(`${currentBaseUrl}/api/files/${sampleFilename}`);
    recordTest('Security Controls', 'Unauthenticated document request rejected (401)', unauthRes.status === 401);

    // Check 2: Unauthenticated /uploads request must return 401
    const unauthUploadsRes = await fetch(`${currentBaseUrl}/uploads/${sampleFilename}`);
    recordTest('Security Controls', 'Unauthenticated /uploads request rejected (401)', unauthUploadsRes.status === 401);

    // Check 3: JWT via query parameter (?token=...) MUST BE REJECTED (Disabled for security)
    const queryTokenRes = await fetch(`${currentBaseUrl}/api/files/${sampleFilename}?token=${agency1Token}`);
    recordTest('Security Controls', 'URL query parameter authentication (?token=...) rejected (401)', queryTokenRes.status === 401);

    const queryTokenUploadsRes = await fetch(`${currentBaseUrl}/uploads/${sampleFilename}?token=${agency1Token}`);
    recordTest('Security Controls', 'URL query token on /uploads rejected (401)', queryTokenUploadsRes.status === 401);

    // Check 4: Cross-Agency Access Restriction:
    // Attach an uploaded file to Agency 1's claim, then verify Agency 2 CANNOT access it
    const testAttachmentMeta = [{
      file_url: `/api/files/${sampleFilename}`,
      file_name: 'test_document.png',
      file_size: 1024,
      file_type: 'image/png',
      uploaded_by: agency1.user.full_name,
      uploaded_date: new Date().toISOString(),
    }];

    await pool.query('UPDATE claims SET attachments = $1 WHERE id = $2', [JSON.stringify(testAttachmentMeta), newClaim.id]);

    // Agency 1 (owner) can download
    const ownerDownloadRes = await fetch(`${currentBaseUrl}/api/files/${sampleFilename}`, {
      headers: { Authorization: `Bearer ${agency1Token}` },
    });
    recordTest('Security Controls', 'Record owner (Agency 1) can access document', ownerDownloadRes.status === 200);

    // Agency 2 (unauthorized third-party) is blocked with 403 Forbidden
    const crossAgencyDownloadRes = await fetch(`${currentBaseUrl}/api/files/${sampleFilename}`, {
      headers: { Authorization: `Bearer ${agency2Token}` },
    });
    recordTest('Security Controls', 'Cross-Agency access blocked (403 Forbidden)', crossAgencyDownloadRes.status === 403);

    // Check 5: Path traversal attack prevention
    const traversalRes = await fetch(`${currentBaseUrl}/api/files/..%2f..%2fpackage.json`, {
      headers: { Authorization: `Bearer ${agency1Token}` },
    });
    recordTest('Security Controls', 'Path traversal attempt blocked with 400 Bad Request', traversalRes.status === 400);

    // -------------------------------------------------------------------------
    // 7. Cleanup Test Records
    // -------------------------------------------------------------------------
    console.log('\n7. CLEANUP');
    await pool.query('DELETE FROM notifications WHERE claim_id = $1', [newClaim.id]);
    await pool.query('DELETE FROM audit_logs WHERE entity_id IN ($1, $2)', [newClaim.id, newSurvey.id]);
    await pool.query('DELETE FROM claims WHERE id = $1', [newClaim.id]);
    await pool.query('DELETE FROM surveys WHERE id = $1', [newSurvey.id]);
    console.log('  ✓ Cleaned up temporary test records (CLM-PERSIST-001 & SVY-PERSIST-001).');

    // Close server
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();

  } catch (err: any) {
    console.error('Final verification error:', err);
    recordTest('Execution', 'Test suite ran without uncaught exceptions', false, err.message);
  }

  // -------------------------------------------------------------------------
  // Report Summary
  // -------------------------------------------------------------------------
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('\n========================================================================');
  console.log(`FINAL VERIFICATION SUMMARY: ${passed}/${total} Checks Passed (${failed} Failed)`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runFinalVerification();
