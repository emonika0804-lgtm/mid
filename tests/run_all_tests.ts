import { setupIsolatedTestDb, cleanTestDb } from './setupIsolatedTestDb';
import { startTestServer, stopTestServer, TestItem } from './testApp';
import { runAuthSuite } from './test_auth';
import { runClaimsSuite } from './test_claims';
import { runSurveysSuite } from './test_surveys';
import { runFinancialSuite } from './test_financial';
import { runDocumentsSuite } from './test_documents';
import { runEmailNotificationsSuite } from './test_email_notifications';
import { runFrontendSuite } from './test_frontend';
import { runDatabaseIntegritySuite } from './test_database_integrity';
import { runMandatoryAttachmentsSuite } from './test_mandatory_attachments_all';
import { runSecurityHygieneTests } from './test_security_hygiene';

interface SuiteResult {
  name: string;
  items: TestItem[];
}

export async function runCompleteAutomatedTestSuite(): Promise<boolean> {
  const startTime = Date.now();
  console.log('======================================================================');
  console.log('   PIL CARGO CLAIM & SURVEY MANAGEMENT SYSTEM');
  console.log('   PHASE 7 — COMPREHENSIVE AUTOMATED TEST SUITE (MASTER RUNNER)');
  console.log('======================================================================\n');

  // 1. Initialize isolated PostgreSQL test database
  await setupIsolatedTestDb();

  // 2. Start test server targeting pil_claims_test_db
  await startTestServer();

  const suites: SuiteResult[] = [];

  try {
    // 3. Execute all suites in sequence
    const authResults = await runAuthSuite();
    suites.push({ name: '1. Authentication & RBAC', items: authResults });

    const claimsResults = await runClaimsSuite();
    suites.push({ name: '2. Claim Management', items: claimsResults });

    const surveysResults = await runSurveysSuite();
    suites.push({ name: '3. Survey Management', items: surveysResults });

    const financialResults = await runFinancialSuite();
    suites.push({ name: '4. Financial Module', items: financialResults });

    const docResults = await runDocumentsSuite();
    suites.push({ name: '5. Document Management (BYTEA)', items: docResults });

    const emailResults = await runEmailNotificationsSuite();
    suites.push({ name: '6. Email & Notifications', items: emailResults });

    const frontendResults = await runFrontendSuite();
    suites.push({ name: '7. Frontend & Component Workflows', items: frontendResults });

    const dbResults = await runDatabaseIntegritySuite();
    suites.push({ name: '8. Database Integrity & Least Privilege', items: dbResults });

    const attResults = await runMandatoryAttachmentsSuite();
    suites.push({ name: '9. Mandatory Attachments Validation', items: attResults });

    const hygieneResults = runSecurityHygieneTests();
    suites.push({ name: '10. Security Hygiene (SEC-01 & SEC-03)', items: hygieneResults.results });
  } finally {
    await stopTestServer();
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  // 4. Output Summary Table
  console.log('\n======================================================================');
  console.log('   PHASE 7 COMPREHENSIVE TEST RESULTS SUMMARY');
  console.log('======================================================================\n');

  let grandTotal = 0;
  let grandPassed = 0;
  let grandFailed = 0;

  console.log(
    '| # | Test Suite Name                              | Passed | Failed | Total | Status |'
  );
  console.log(
    '|---|----------------------------------------------|:------:|:------:|:-----:|:------:|'
  );

  suites.forEach((suite, idx) => {
    const passed = suite.items.filter((i) => i.pass).length;
    const failed = suite.items.filter((i) => !i.pass).length;
    const total = suite.items.length;
    grandTotal += total;
    grandPassed += passed;
    grandFailed += failed;
    const status = failed === 0 ? '✅ PASS' : '❌ FAIL';
    const num = (idx + 1).toString().padEnd(2, ' ');
    const name = suite.name.padEnd(44, ' ');
    const passStr = passed.toString().padStart(6, ' ');
    const failStr = failed.toString().padStart(6, ' ');
    const totStr = total.toString().padStart(5, ' ');
    console.log(`| ${num}| ${name} | ${passStr} | ${failStr} | ${totStr} | ${status} |`);
  });

  console.log(
    '|---|----------------------------------------------|:------:|:------:|:-----:|:------:|'
  );
  console.log(
    `|   | TOTAL ACROSS ALL SUITES                      | ${grandPassed.toString().padStart(6, ' ')} | ${grandFailed.toString().padStart(6, ' ')} | ${grandTotal.toString().padStart(5, ' ')} | ${grandFailed === 0 ? '✅ PASS' : '❌ FAIL'} |`
  );

  console.log(`\nExecution Time: ${durationSec}s`);
  console.log(`Total Tests Run: ${grandTotal}`);
  console.log(`Passed: ${grandPassed} (${Math.round((grandPassed / grandTotal) * 100)}%)`);
  console.log(`Failed: ${grandFailed}`);

  if (grandFailed > 0) {
    console.error('\nFAILURES DETECTED:');
    suites.forEach((s) => {
      s.items
        .filter((i) => !i.pass)
        .forEach((i) => console.error(`  - [${s.name}] ${i.id}: ${i.name} (${i.details || ''})`));
    });
  }

  return grandFailed === 0;
}

if (require.main === module) {
  runCompleteAutomatedTestSuite()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal Test Runner Error:', err);
      process.exit(1);
    });
}
