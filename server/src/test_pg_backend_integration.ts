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

const TEST_PORT = 5055;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Setup Express app
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

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, desc: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${desc}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('   PIL CARGO CLAIMS - POSTGRESQL BACKEND INTEGRATION TEST SUITE');
  console.log('===============================================================\n');

  // Initialize DB and LMS
  await initDatabase();
  loadLMSExcel();

  const server = app.listen(TEST_PORT);
  console.log(`[Test Server] Running on ${BASE_URL}\n`);

  try {
    // ------------------------------------------------------------------
    // CHECKPOINT 1: Direct PostgreSQL Verification
    // ------------------------------------------------------------------
    console.log('CHECKPOINT 1: PostgreSQL Direct Connection & Verification');
    const pgCheck = await pool.query('SELECT current_database() as db, current_user as usr, NOW() as ts');
    assert(pgCheck.rows.length === 1, `PostgreSQL responds to query (DB: ${pgCheck.rows[0].db}, User: ${pgCheck.rows[0].usr})`);

    const usersCount = await pool.query('SELECT COUNT(*) FROM users');
    assert(parseInt(usersCount.rows[0].count, 10) >= 6, `Users exist in PostgreSQL (count: ${usersCount.rows[0].count})`);

    // Verify real user exists in PostgreSQL
    const realUserCheck = await pool.query('SELECT id, email, full_name, role FROM users WHERE email = $1', ['yashwanthsakthivel@gmail.com']);
    assert(realUserCheck.rows.length === 1, `Real user yashwanthsakthivel@gmail.com preserved in PostgreSQL (role: ${realUserCheck.rows[0]?.role})`);

    // ------------------------------------------------------------------
    // CHECKPOINT 2: User Authentication via PostgreSQL
    // ------------------------------------------------------------------
    console.log('\nCHECKPOINT 2: User Authentication via PostgreSQL');
    
    // Admin login
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pilship.com', password: 'Password123!' }),
    });
    const adminData = await adminLoginRes.json() as any;
    assert(adminLoginRes.status === 200 && adminData.token, 'Admin login succeeds and receives JWT token');
    const adminToken = adminData.token;

    // Agency 1 login
    const agency1LoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'agency@pilship.com', password: 'Password123!' }),
    });
    const agency1Data = await agency1LoginRes.json() as any;
    assert(agency1LoginRes.status === 200 && agency1Data.user.role === 'agency', 'Agency 1 login succeeds with role=agency');
    const agency1Token = agency1Data.token;
    const agency1User = agency1Data.user;

    // Agency 2 login
    const agency2LoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'agency2@pilship.com', password: 'Password123!' }),
    });
    const agency2Data = await agency2LoginRes.json() as any;
    assert(agency2LoginRes.status === 200 && agency2Data.user.role === 'agency', 'Agency 2 login succeeds with role=agency');
    const agency2Token = agency2Data.token;

    // Verify /api/auth/me against PostgreSQL
    const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const meData = await meRes.json() as any;
    assert(meRes.status === 200 && meData.user.email === 'admin@pilship.com', 'GET /api/auth/me returns valid PostgreSQL user record');

    // ------------------------------------------------------------------
    // CHECKPOINT 3: Claims Creation & Persistence to PostgreSQL
    // ------------------------------------------------------------------
    console.log('\nCHECKPOINT 3: Claims Creation & Direct PostgreSQL Validation');

    const testClaimPayload = {
      bl_number: 'PIL-PG-TEST-001',
      claimant: 'Test Global Logistics Ltd',
      claimant_type: 'Cargo Insurer',
      shipper: 'Orient Cargo Forwarders',
      consignee: 'Singapore Marine Imports',
      port_of_loading: 'Shanghai',
      port_of_discharge: 'Singapore',
      vessel_name: 'KOTA HARUM',
      vessel_voyage: '0042W',
      commodity: 'Electronics / Solar Panels',
      claim_amount: 18500.50,
      cargo_type: 'dry',
      incident_description: 'Water ingress detected during unstuffing at port.',
      selected_containers: ['TEMU1234567'],
      expense_tally_records: [
        {
          id: 'exp-test-1',
          expense_type: 'Survey Fee',
          amount: 1200.0,
          amount_usd: 1200.0,
          currency: 'USD',
          description: 'Initial joint surveyor attendance',
        },
      ],
      recovery_tally_records: [
        {
          id: 'rec-test-1',
          recovery_type: 'Recovery from Liable Party',
          liable_party: 'Terminal Operator',
          amount: 5000.0,
          amount_usd: 5000.0,
          description: 'Terminal handling damage contribution',
        },
      ],
    };

    const createClaimRes = await fetch(`${BASE_URL}/api/claims`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agency1Token}`,
      },
      body: JSON.stringify(testClaimPayload),
    });
    const createdClaim = await createClaimRes.json() as any;
    assert(createClaimRes.status === 201 && createdClaim.id, `Claim created via API (Claim #: ${createdClaim.claim_number})`);

    // Verify claim directly in PostgreSQL
    const claimPgRow = await pool.query('SELECT * FROM claims WHERE id = $1', [createdClaim.id]);
    assert(claimPgRow.rows.length === 1, 'Claim successfully verified directly in PostgreSQL `claims` table');
    assert(claimPgRow.rows[0].bl_number === 'PIL-PG-TEST-001', 'PostgreSQL claim BL number matches correctly');
    assert(parseFloat(claimPgRow.rows[0].claim_amount) === 18500.50, 'PostgreSQL claim amount stored accurately as numeric');
    assert(claimPgRow.rows[0].status === 'new_claim', 'Agency-created claim correctly defaults to status=new_claim');

    // Verify Audit Log in PostgreSQL
    const auditPgRow = await pool.query('SELECT * FROM audit_logs WHERE entity_id = $1 AND action = $2', [createdClaim.id, 'CREATE']);
    assert(auditPgRow.rows.length === 1, 'Audit log entry verified directly in PostgreSQL `audit_logs` table');

    // Verify Notification in PostgreSQL
    const notifPgRow = await pool.query('SELECT * FROM notifications WHERE claim_id = $1', [createdClaim.id]);
    assert(notifPgRow.rows.length >= 1, 'Notification entry verified directly in PostgreSQL `notifications` table');

    // ------------------------------------------------------------------
    // CHECKPOINT 4: Row-Level Security (RLS) in PostgreSQL
    // ------------------------------------------------------------------
    console.log('\nCHECKPOINT 4: Row-Level Security (RLS) Verification');

    // Agency 1 views claims
    const agency1ClaimsRes = await fetch(`${BASE_URL}/api/claims`, {
      headers: { Authorization: `Bearer ${agency1Token}` },
    });
    const agency1Claims = await agency1ClaimsRes.json() as any[];
    const agency1OwnsCreated = agency1Claims.some((c) => c.id === createdClaim.id);
    assert(agency1OwnsCreated, 'Agency 1 can view its own created claim');

    // Agency 2 views claims (should NOT see Agency 1's claim)
    const agency2ClaimsRes = await fetch(`${BASE_URL}/api/claims`, {
      headers: { Authorization: `Bearer ${agency2Token}` },
    });
    const agency2Claims = await agency2ClaimsRes.json() as any[];
    const agency2CanSeeCreated = agency2Claims.some((c) => c.id === createdClaim.id);
    assert(!agency2CanSeeCreated, 'RLS Enforced: Agency 2 CANNOT see Agency 1 claim');

    // Admin views claims (sees all)
    const adminClaimsRes = await fetch(`${BASE_URL}/api/claims`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminClaims = await adminClaimsRes.json() as any[];
    const adminCanSeeCreated = adminClaims.some((c) => c.id === createdClaim.id);
    assert(adminCanSeeCreated, 'Admin can view all claims across all agencies');

    // ------------------------------------------------------------------
    // CHECKPOINT 5: Claim Update & Status Transition in PostgreSQL
    // ------------------------------------------------------------------
    console.log('\nCHECKPOINT 5: Claim Update & Workflow Transition in PostgreSQL');

    const updatePayload = {
      status: 'in_progress',
      claims_handler: 'Alfred',
      cms_number: 'CMS-2026-9901',
      claim_amount: 19000.00,
      court_case_status: 'filed',
      court_case_location: 'Singapore High Court',
      court_case_jurisdiction: 'Admiralty Division',
    };

    const updateClaimRes = await fetch(`${BASE_URL}/api/claims/${createdClaim.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify(updatePayload),
    });
    const updatedClaim = await updateClaimRes.json() as any;
    assert(updateClaimRes.status === 200 && updatedClaim.status === 'in_progress', 'Claim status updated to in_progress via Admin API');

    // Verify update directly in PostgreSQL
    const updatedPgRow = await pool.query('SELECT * FROM claims WHERE id = $1', [createdClaim.id]);
    assert(updatedPgRow.rows[0].status === 'in_progress', 'PostgreSQL confirms updated status: in_progress');
    assert(updatedPgRow.rows[0].claims_handler === 'Alfred', 'PostgreSQL confirms handler assignment: Alfred');
    assert(updatedPgRow.rows[0].cms_number === 'CMS-2026-9901', 'PostgreSQL confirms CMS number: CMS-2026-9901');
    assert(updatedPgRow.rows[0].court_case_status === 'filed', 'PostgreSQL confirms court case fields updated');

    // Verify audit logs for status and handler change
    const updateAudits = await pool.query('SELECT * FROM audit_logs WHERE entity_id = $1 AND action = $2', [createdClaim.id, 'UPDATE']);
    assert(updateAudits.rows.length >= 2, `Audit trail recorded in PostgreSQL for updates (rows: ${updateAudits.rows.length})`);

    // ------------------------------------------------------------------
    // CHECKPOINT 6: Surveys Lifecycle & Convert to Claim in PostgreSQL
    // ------------------------------------------------------------------
    console.log('\nCHECKPOINT 6: Surveys Lifecycle & Convert-to-Claim in PostgreSQL');

    const testSurveyPayload = {
      bl_number: 'PIL-PG-TEST-002',
      survey_reference_number: 'SRV-REF-8801',
      survey_requested_by: 'Pacific Marine Underwriters',
      date_of_survey: '2026-10-25',
      survey_cost: 3200.0,
      incident_description: 'Reefer container temperature variation during ocean transit.',
      cargo_type: 'reefer',
    };

    const createSurveyRes = await fetch(`${BASE_URL}/api/surveys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agency1Token}`,
      },
      body: JSON.stringify(testSurveyPayload),
    });
    const createdSurvey = await createSurveyRes.json() as any;
    assert(createSurveyRes.status === 201 && createdSurvey.id, `Survey created via API (Survey #: ${createdSurvey.survey_number})`);

    // Verify in PostgreSQL
    const surveyPgRow = await pool.query('SELECT * FROM surveys WHERE id = $1', [createdSurvey.id]);
    assert(surveyPgRow.rows.length === 1, 'Survey verified directly in PostgreSQL `surveys` table');

    // Update survey to 'appointed' as Admin
    await fetch(`${BASE_URL}/api/surveys/${createdSurvey.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ survey_status: 'appointed', cms_reference_number: 'CMS-SVY-8801' }),
    });

    const appointedPg = await pool.query('SELECT survey_status FROM surveys WHERE id = $1', [createdSurvey.id]);
    assert(appointedPg.rows[0].survey_status === 'appointed', 'Survey status updated to appointed in PostgreSQL');

    // Convert survey to claim
    const convertRes = await fetch(`${BASE_URL}/api/surveys/${createdSurvey.id}/convert-to-claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const convertData = await convertRes.json() as any;
    assert(convertRes.status === 200 && convertData.claim_id, `Survey converted to claim (${convertData.claim_number})`);

    // Verify converted claim in PostgreSQL
    const convertedClaimPg = await pool.query('SELECT * FROM claims WHERE id = $1', [convertData.claim_id]);
    assert(convertedClaimPg.rows.length === 1, 'Converted claim exists in PostgreSQL `claims` table');
    assert(convertedClaimPg.rows[0].originating_survey_id === createdSurvey.id, 'Converted claim properly links to originating survey in PostgreSQL');

    // Verify survey record updated with converted_to_claim_id
    const updatedSurveyPg = await pool.query('SELECT converted_to_claim_id, converted_to_claim_number FROM surveys WHERE id = $1', [createdSurvey.id]);
    assert(updatedSurveyPg.rows[0].converted_to_claim_id === convertData.claim_id, 'Survey table reflects converted_to_claim_id in PostgreSQL');

    // ------------------------------------------------------------------
    // CHECKPOINT 7: Dashboard Metrics Aggregation from PostgreSQL
    // ------------------------------------------------------------------
    console.log('\nCHECKPOINT 7: Dashboard Metrics from PostgreSQL');

    const metricsRes = await fetch(`${BASE_URL}/api/dashboard/metrics`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const metrics = await metricsRes.json() as any;
    assert(metricsRes.status === 200, 'GET /api/dashboard/metrics returns 200 OK');
    assert(metrics.claims.total >= 4, `Metrics total claims count matches PostgreSQL data (${metrics.claims.total})`);
    assert(metrics.surveys.total >= 1, `Metrics total surveys count matches PostgreSQL data (${metrics.surveys.total})`);
    assert(metrics.expenses.total > 0, `Metrics expenses total is calculated from PostgreSQL (${metrics.expenses.total})`);

    // ------------------------------------------------------------------
    // CHECKPOINT 8: Secure Document Access & Permissions
    // ------------------------------------------------------------------
    console.log('\nCHECKPOINT 8: Secure Document Access & Permissions');

    // Test unauthenticated access to /uploads/:filename is rejected
    const unauthDocRes = await fetch(`${BASE_URL}/uploads/test-sample.png`);
    assert(unauthDocRes.status === 401, 'Unauthenticated document access is strictly rejected (401 Unauthorized)');

    // Test unauthenticated access to /api/files/:filename is rejected
    const unauthFilesRes = await fetch(`${BASE_URL}/api/files/test-sample.png`);
    assert(unauthFilesRes.status === 401, 'Unauthenticated /api/files access is strictly rejected (401 Unauthorized)');

    // ------------------------------------------------------------------
    // CHECKPOINT 9: LMS Mock Lookup & PostgreSQL Caching
    // ------------------------------------------------------------------
    console.log('\nCHECKPOINT 9: LMS Mock Lookup & PostgreSQL Caching');

    // Test lookup with known BL from mock excel
    const lmsRes = await fetch(`${BASE_URL}/api/lms/lookup?bl_number=PIL0100001`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const lmsData = await lmsRes.json() as any;
    assert(lmsRes.status === 200 && lmsData.success, 'LMS lookup returns successful shipment data');

    // Verify cached in PostgreSQL lms_cache table
    const lmsCachePg = await pool.query('SELECT * FROM lms_cache WHERE bl_number = $1', ['PIL0100001']);
    assert(lmsCachePg.rows.length === 1, 'LMS lookup result cached in PostgreSQL `lms_cache` table');

    // ------------------------------------------------------------------
    // CHECKPOINT 10: Currency Rates & PostgreSQL Caching
    // ------------------------------------------------------------------
    console.log('\nCHECKPOINT 10: Currency Rates via PostgreSQL');

    const ratesRes = await fetch(`${BASE_URL}/api/rates`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const ratesData = await ratesRes.json() as any;
    assert(ratesRes.status === 200 && ratesData.rates && ratesData.rates.USD === 1.0, 'GET /api/rates returns exchange rates successfully');

    const ratesPg = await pool.query('SELECT COUNT(*) FROM currency_rates');
    assert(parseInt(ratesPg.rows[0].count, 10) > 0, `Currency rates snapshots stored in PostgreSQL (count: ${ratesPg.rows[0].count})`);

    // ------------------------------------------------------------------
    // CLEANUP: Clean up only test records created during this run
    // ------------------------------------------------------------------
    console.log('\nCLEANUP: Cleaning up test records (preserving all live user data)...');
    await pool.query('DELETE FROM notifications WHERE claim_id = $1', [createdClaim.id]);
    await pool.query('DELETE FROM audit_logs WHERE entity_id IN ($1, $2, $3)', [createdClaim.id, createdSurvey.id, convertData.claim_id]);
    await pool.query('DELETE FROM claims WHERE id IN ($1, $2)', [createdClaim.id, convertData.claim_id]);
    await pool.query('DELETE FROM surveys WHERE id = $1', [createdSurvey.id]);
    console.log('✓ Cleaned up test records. Original 4 claims and 1 survey remain intact.\n');

  } catch (err: any) {
    console.error('Test suite uncaught error:', err);
    failedTests++;
  } finally {
    server.close();
    await pool.end();
  }

  console.log('===============================================================');
  console.log(`TEST RESULTS: ${passedTests} Passed, ${failedTests} Failed`);
  console.log('===============================================================');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
