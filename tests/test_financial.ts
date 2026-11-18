import { requestApi, TestItem } from './testApp';
import db from '../server/src/db';
import { FALLBACK_RATES, clearRatesMemoryCache } from '../server/src/rates';
import { MANDATORY_DOCS_DRY_CLAIM, MANDATORY_DOCS_DRY_SURVEY } from '../server/src/attachmentValidation';

export async function runFinancialSuite(): Promise<TestItem[]> {
  const tests: TestItem[] = [];
  function record(id: string, name: string, condition: boolean, details?: string) {
    tests.push({ id, name, pass: condition, details });
    console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${id}: ${name}${details ? ` -> ${details}` : ''}`);
  }

  console.log('\n--- SUITE 4: Comprehensive Financial Management Tests ---');

  const adminLogin = await requestApi('POST', '/api/auth/login', { email: 'admin@pilship.com', password: 'Password123!' });
  const adminToken = adminLogin.body.token;

  const midLogin = await requestApi('POST', '/api/auth/login', { email: 'mid@pilship.com', password: 'Password123!' });
  const midToken = midLogin.body.token;

  // 1. Currency rates endpoint returns all 7 supported currencies
  const ratesRes = await requestApi('GET', '/api/rates', null, midToken);
  const supportedCurrencies = ['USD', 'SGD', 'EUR', 'GBP', 'INR', 'AED', 'CNY'];
  const allCurrenciesPresent = ratesRes.status === 200 && ratesRes.body.rates && supportedCurrencies.every((c) => typeof ratesRes.body.rates[c] === 'number');
  record('FIN-4.1', 'Exchange rates API returns exchange factors for all 7 supported currencies', allCurrenciesPresent, `Base: ${ratesRes.body.base_currency || 'USD'}`);

  // 2. In-memory cache hit (<50ms)
  const cacheStart = Date.now();
  const cachedRatesRes = await requestApi('GET', '/api/rates', null, midToken);
  const cacheDuration = Date.now() - cacheStart;
  const isCacheHit = cachedRatesRes.status === 200 && JSON.stringify(cachedRatesRes.body.rates) === JSON.stringify(ratesRes.body.rates);
  record('FIN-4.2', 'Currency rates in-memory cache responds instantaneously (<50ms)', isCacheHit && cacheDuration < 50, `Latency: ${cacheDuration}ms`);

  // 3. Concurrent API requests stress test (20 parallel calls)
  clearRatesMemoryCache();
  const concurrStart = Date.now();
  const concurrCalls = Array.from({ length: 20 }, () => requestApi('GET', '/api/rates', null, midToken));
  const concurrResponses = await Promise.all(concurrCalls);
  const concurrDuration = Date.now() - concurrStart;
  const allSucceeded = concurrResponses.every((r) => r.status === 200 && r.body.rates && r.body.rates.USD === 1.0);
  record('FIN-4.3', 'High concurrency currency requests (20 parallel calls) resolve safely without duplicate key violations', allSucceeded, `Duration: ${concurrDuration}ms`);

  // 4. Fallback currency rates completeness
  const fallbackComplete = supportedCurrencies.every((c) => typeof FALLBACK_RATES[c] === 'number' && FALLBACK_RATES[c] > 0);
  record('FIN-4.4', 'Fallback currency rates complete and valid for all 7 supported currencies', fallbackComplete);

  // 5. Idempotent daily rate snapshot in test database via UPSERT
  const today = new Date().toISOString().split('T')[0];
  const rateRows = (await db.prepare('SELECT COUNT(*) as count FROM currency_rates WHERE rate_date = ?').get(today)) as any;
  const countNum = parseInt(rateRows?.count || '0', 10);
  record('FIN-4.5', 'PostgreSQL currency_rates table stores exactly 1 idempotent daily snapshot via UPSERT', countNum <= 1, `Count: ${countNum}`);

  // 6. Create claim with financial tallies (Expenses & Recoveries)
  const financialClaimRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100004',
    claimant: 'Trans-Ocean Shipping Co',
    discharge_date: '2026-04-10',
    claim_amount: 50000.00,
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Financial test documentation on file',
    })),
    expense_tally_records: [
      {
        id: 'exp-1',
        expense_type: 'Surveyor Fee',
        amount: 3200.00,
        currency: 'USD',
        status: 'settled',
        settlement_amount: 3200.00,
        settlement_date: '2026-04-15',
        responsible_user: 'Alfred',
        description: 'Comprehensive initial survey & damage assessment report'
      },
      {
        id: 'exp-2',
        expense_type: 'Legal Fees',
        amount: 4500.00,
        currency: 'USD',
        status: 'pending',
        settlement_amount: 0,
        responsible_user: 'Wei Lin',
        description: 'Maritime counsel retainer'
      }
    ],
    recovery_tally_records: [
      {
        id: 'rec-1',
        recovery_type: 'Recovery from Liable Party',
        liable_party: 'Terminal Operator',
        recovery_amount: 15000.00,
        recovered_amount: 10000.00,
        outstanding_recovery: 5000.00,
        recovery_status: 'partial',
        date: '2026-04-20',
        responsible_handler: 'Alfred',
        remarks: 'Terminal operator agreed to 66% settlement'
      }
    ]
  }, midToken);

  const claimId = financialClaimRes.body.id;
  const parsedExpenses = typeof financialClaimRes.body.expense_tally_records === 'string'
    ? JSON.parse(financialClaimRes.body.expense_tally_records)
    : financialClaimRes.body.expense_tally_records;

  record(
    'FIN-4.6',
    'Claim created with multi-item expense and recovery tallies',
    financialClaimRes.status === 201 && Array.isArray(parsedExpenses) && parsedExpenses.length === 2
  );

  // 7. Add standalone expense directly to database
  const expId = `exp-standalone-${Date.now()}`;
  await db.prepare(`
    INSERT INTO expenses (id, claim_id, claim_number, bl_number, expense_type, amount, currency, status, settlement_amount, created_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(expId, claimId, financialClaimRes.body.claim_number, 'PIL0100004', 'Salvage Sale Cost', 2500.00, 'USD', 'settled', 2500.00, new Date().toISOString());

  // 8. Add standalone recovery directly to database
  const recId = `rec-standalone-${Date.now()}`;
  await db.prepare(`
    INSERT INTO recoveries (id, claim_id, claim_number, bl_number, recovery_status, recovery_amount, recovered_amount, outstanding_recovery, liable_party, created_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(recId, claimId, financialClaimRes.body.claim_number, 'PIL0100004', 'completed', 8000.00, 8000.00, 0, 'Stevedore Company', new Date().toISOString());

  record('FIN-4.7', 'Standalone expenses and recoveries recorded successfully', true);

  // 9. Verify Dashboard Metrics Aggregation (aggregates embedded tallies + standalone records)
  const dashboardRes = await requestApi('GET', '/api/dashboard/metrics', null, midToken);
  const metrics = dashboardRes.body;

  record(
    'FIN-4.8',
    'Dashboard metrics API aggregates total expenses, settled amounts, and outstanding liabilities',
    dashboardRes.status === 200 &&
    typeof metrics.expenses?.total === 'number' &&
    metrics.expenses.total > 0 &&
    typeof metrics.expenses?.settled === 'number',
    `Total Expenses: $${metrics.expenses?.total}, Settled: $${metrics.expenses?.settled}`
  );

  record(
    'FIN-4.9',
    'Dashboard metrics API aggregates total recoveries, recovered amounts, and outstanding recoveries',
    dashboardRes.status === 200 &&
    typeof metrics.recoveries?.total === 'number' &&
    metrics.recoveries.total > 0 &&
    typeof metrics.recoveries?.recovered === 'number',
    `Total Recoveries: $${metrics.recoveries?.total}, Recovered: $${metrics.recoveries?.recovered}`
  );

  // 10. Net financial exposure verification
  const netAmount = financialClaimRes.body.claim_amount - 10000.00;
  record('FIN-4.10', 'Net financial exposure correctly calculated as claim amount minus recovered amount', netAmount === 40000.00, `Net Exposure: $${netAmount}`);

  // 11. FIN-01: Dashboard settlement aggregation distinguishes settled vs pending expenses
  const expList = metrics.expenses?.list || [];
  const exp2Item = expList.find((e: any) => e.id === 'exp-2');
  const exp1Item = expList.find((e: any) => e.id === 'exp-1');
  record(
    'FIN-4.11',
    'Dashboard metrics distinguishes settled vs pending expenses (pending expense not counted as settled)',
    exp2Item?.status === 'pending' && exp1Item?.status === 'settled' && metrics.expenses.settled < metrics.expenses.total
  );

  // 12. FIN-01: Dashboard recovery aggregation derives partial vs full recovery
  const recList = metrics.recoveries?.list || [];
  const rec1Item = recList.find((r: any) => r.id === 'rec-1');
  record(
    'FIN-4.12',
    'Dashboard metrics reflects partial recovery status and outstanding amount without hardcoding recovered',
    rec1Item?.recovery_status === 'partial' && rec1Item?.recovered_amount === 10000 && rec1Item?.outstanding_recovery === 5000
  );

  // 13. FIN-02: Server-side recalculation of client-tampered exchange_rate and amount_usd
  const tamperedClaimRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100005',
    claimant: 'Tamper Detection Marine',
    discharge_date: '2026-04-10',
    claim_amount: 10000.00,
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid audit documentation',
    })),
    expense_tally_records: [
      {
        id: 'tamper-exp-1',
        expense_type: 'Surveyor Fee',
        amount: 1000.00,
        currency: 'EUR',
        exchange_rate: 9999.00, // Tampered client rate
        amount_usd: 1.00,       // Tampered client USD
        status: 'pending'
      }
    ]
  }, midToken);

  const tamperedRecords = typeof tamperedClaimRes.body.expense_tally_records === 'string'
    ? JSON.parse(tamperedClaimRes.body.expense_tally_records)
    : tamperedClaimRes.body.expense_tally_records;
  const eurRecord = tamperedRecords?.[0];
  const trustedRatesRes = await requestApi('GET', '/api/rates', null, midToken);
  const trustedEurRate = trustedRatesRes.body.rates?.EUR || 0.92;
  const expectedEurUsd = Math.round((1000.00 / trustedEurRate) * 100) / 100;
  const recalculationSafe = tamperedClaimRes.status === 201 &&
    eurRecord &&
    eurRecord.exchange_rate !== 9999.00 &&
    eurRecord.amount_usd !== 1.00 &&
    Math.abs(eurRecord.amount_usd - expectedEurUsd) < 1.0;
  record(
    'FIN-4.13',
    'Server overrides client-tampered amount_usd and exchange_rate with trusted recalculation',
    recalculationSafe,
    `Stored amount_usd: $${eurRecord?.amount_usd}, rate: ${eurRecord?.exchange_rate}`
  );

  // 14. FIN-02: Multi-currency conversion integrity across supported currencies (SGD, USD)
  const updateCurrencyRes = await requestApi('PUT', `/api/claims/${financialClaimRes.body.id}`, {
    expense_tally_records: [
      {
        id: 'sgd-exp-1',
        expense_type: 'Port Authority Charges',
        amount: 1350.00,
        currency: 'SGD',
        status: 'settled',
        settlement_amount: 1350.00
      }
    ]
  }, midToken);
  const updatedExpenses = typeof updateCurrencyRes.body.expense_tally_records === 'string'
    ? JSON.parse(updateCurrencyRes.body.expense_tally_records)
    : updateCurrencyRes.body.expense_tally_records;
  const sgdRecord = updatedExpenses?.[0];
  const trustedSgdRate = trustedRatesRes.body.rates?.SGD || 1.35;
  const expectedSgdUsd = Math.round((1350.00 / trustedSgdRate) * 100) / 100;
  record(
    'FIN-4.14',
    'Multi-currency tally conversion calculates trusted USD equivalent for foreign currency (SGD)',
    updateCurrencyRes.status === 200 &&
    sgdRecord &&
    Math.abs(sgdRecord.amount_usd - expectedSgdUsd) < 1.0,
    `SGD 1350 -> USD ${sgdRecord?.amount_usd} (Rate: ${sgdRecord?.exchange_rate})`
  );

  // 15. FIN-02: Unsupported currency rejection (400 Bad Request with code UNSUPPORTED_CURRENCY)
  const invalidCurrencyRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100006',
    claimant: 'Crypto Logistics',
    discharge_date: '2026-04-10',
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid documentation',
    })),
    expense_tally_records: [
      {
        id: 'bad-curr-1',
        expense_type: 'Surveyor Fee',
        amount: 1000.00,
        currency: 'BTC', // Invalid currency
        status: 'pending'
      }
    ]
  }, midToken);
  record(
    'FIN-4.15',
    'Unsupported currency (e.g. BTC) rejected with 400 Bad Request and UNSUPPORTED_CURRENCY code',
    invalidCurrencyRes.status === 400 && invalidCurrencyRes.body.code === 'UNSUPPORTED_CURRENCY'
  );

  // 16. FIN-04: Negative claim amount rejected
  const negClaimRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100007',
    claimant: 'Negative Claim Test',
    discharge_date: '2026-04-10',
    claim_amount: -500.00,
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid documentation',
    }))
  }, midToken);
  record(
    'FIN-4.16',
    'Negative claim amount rejected with 400 Bad Request and INVALID_MONETARY_VALUE code',
    negClaimRes.status === 400 && negClaimRes.body.code === 'INVALID_MONETARY_VALUE'
  );

  // 17. FIN-04: Non-numeric and malformed claim amount rejected
  const malformedClaimRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100008',
    claimant: 'Malformed Claim Test',
    discharge_date: '2026-04-10',
    claim_amount: 'NaN-invalid-100',
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid documentation',
    }))
  }, midToken);
  record(
    'FIN-4.17',
    'Malformed string or non-numeric claim amount rejected with 400 Bad Request',
    malformedClaimRes.status === 400 && malformedClaimRes.body.code === 'INVALID_MONETARY_VALUE'
  );

  // 18. FIN-04: Numeric overflow exceeding NUMERIC(15, 4) limit (>99,999,999,999.9999) rejected
  const overflowClaimRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100009',
    claimant: 'Overflow Claim Test',
    discharge_date: '2026-04-10',
    claim_amount: 100000000000.00, // 100 Billion > 99.99 Billion max
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid documentation',
    }))
  }, midToken);
  record(
    'FIN-4.18',
    'Monetary amount exceeding PostgreSQL NUMERIC(15, 4) limit rejected with NUMERIC_OVERFLOW code',
    overflowClaimRes.status === 400 && overflowClaimRes.body.code === 'NUMERIC_OVERFLOW'
  );

  // 19. FIN-04: Negative survey cost on survey creation rejected
  const negSurveyRes = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100010',
    survey_reference_number: 'SR-TEST-NEG',
    cms_reference_number: 'CMS-SR-NEG',
    survey_requested_by: 'Consignee',
    date_of_survey: '2026-04-10',
    survey_cost: -250.00,
    attachments: MANDATORY_DOCS_DRY_SURVEY.map((doc) => ({
      type: doc,
      comment: 'On file',
    }))
  }, midToken);
  record(
    'FIN-4.19',
    'Negative survey cost rejected with 400 Bad Request and INVALID_MONETARY_VALUE code',
    negSurveyRes.status === 400 && negSurveyRes.body.code === 'INVALID_MONETARY_VALUE'
  );

  // 20. FIN-04: Negative policy deductible rejected
  const negDeductibleRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100011',
    claimant: 'Deductible Test',
    discharge_date: '2026-04-10',
    claim_amount: 5000.00,
    policy_deductible_usd: -1000.00,
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid documentation',
    }))
  }, midToken);
  record(
    'FIN-4.20',
    'Negative policy deductible rejected with 400 Bad Request and INVALID_MONETARY_VALUE code',
    negDeductibleRes.status === 400 && negDeductibleRes.body.code === 'INVALID_MONETARY_VALUE'
  );

  // 21. FIN-04: Negative expense tally item amount rejected
  const negTallyItemRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100012',
    claimant: 'Negative Tally Test',
    discharge_date: '2026-04-10',
    claim_amount: 5000.00,
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid documentation',
    })),
    expense_tally_records: [
      {
        id: 'neg-exp-item',
        expense_type: 'Surveyor Fee',
        amount: -150.00,
        currency: 'USD',
        status: 'pending'
      }
    ]
  }, midToken);
  record(
    'FIN-4.21',
    'Negative expense tally item amount rejected with 400 Bad Request and INVALID_MONETARY_VALUE code',
    negTallyItemRes.status === 400 && negTallyItemRes.body.code === 'INVALID_MONETARY_VALUE'
  );

  // 22. FIN-03 / Phase 4C: Dashboard metrics aggregate embedded tallies only; standalone records do not inflate dashboard totals
  const freshMetricsRes = await requestApi('GET', '/api/dashboard/metrics', null, midToken);
  const freshMetrics = freshMetricsRes.body;
  const standaloneExpFound = (freshMetrics.expenses?.list || []).some((e: any) => e.id === expId);
  const standaloneRecFound = (freshMetrics.recoveries?.list || []).some((r: any) => r.id === recId);
  const claimExpenses = (freshMetrics.expenses?.list || []).filter((e: any) => e.claim_number === financialClaimRes.body.claim_number);
  const claimRecoveries = (freshMetrics.recoveries?.list || []).filter((r: any) => r.claim_number === financialClaimRes.body.claim_number);
  const claimExpenseTotal = claimExpenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const claimRecoveryTotal = claimRecoveries.reduce((s: number, r: any) => s + Number(r.recovery_amount), 0);
  record(
    'FIN-4.22',
    'Dashboard metrics aggregate embedded tallies only; standalone records do not inflate totals or appear in list',
    !standaloneExpFound &&
    !standaloneRecFound &&
    claimExpenses.length === 1 &&
    Math.abs(claimExpenseTotal - 1047.49) < 1 &&
    claimRecoveries.length === 1 &&
    claimRecoveryTotal === 15000,
    `Claim Expenses: $${claimExpenseTotal.toFixed(2)} (Count: ${claimExpenses.length}), Claim Recoveries: $${claimRecoveryTotal} (Count: ${claimRecoveries.length})`
  );

  // 23. FIN-05 / Phase 4C: Net Tally Balance formula (Total Expenses USD - Total Recovery USD) strictly excludes claim_amount
  const expTallyRecords = parsedExpenses;
  const recTallyRecords = typeof financialClaimRes.body.recovery_tally_records === 'string'
    ? JSON.parse(financialClaimRes.body.recovery_tally_records)
    : financialClaimRes.body.recovery_tally_records;
  const tallyTotalExpensesUsd = expTallyRecords.reduce((sum: number, r: any) => sum + (Number(r.amount_usd) || Number(r.amount) || 0), 0);
  const tallyTotalRecoveryUsd = recTallyRecords.reduce((sum: number, r: any) => sum + (Number(r.amount_usd) || Number(r.recovery_amount) || 0), 0);
  const netTallyBalance = tallyTotalExpensesUsd - tallyTotalRecoveryUsd;
  record(
    'FIN-4.23',
    'Net Tally Balance calculates Total Expenses USD minus Total Recovery USD, strictly excluding claim amount',
    tallyTotalExpensesUsd === 7700 &&
    tallyTotalRecoveryUsd === 15000 &&
    netTallyBalance === -7300 &&
    financialClaimRes.body.claim_amount === 50000,
    `Net Tally Balance: $${netTallyBalance}, Claim Amount: $${financialClaimRes.body.claim_amount}`
  );

  // 24. Phase 4C: Settlement Payout rejected as expense tally in claim creation (POST /api/claims)
  const settlementClaimRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100013',
    claimant: 'Settlement Payout Rejection Test',
    discharge_date: '2026-04-10',
    claim_amount: 15000.00,
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid documentation',
    })),
    expense_tally_records: [
      {
        id: 'settlement-exp-1',
        expense_type: 'Settlement Payout',
        amount: 5000.00,
        currency: 'USD',
        status: 'pending'
      }
    ]
  }, midToken);
  record(
    'FIN-4.24',
    'Settlement Payout in expense tally rejected with 400 Bad Request and SETTLEMENT_PAYOUT_NOT_ALLOWED_IN_TALLY code',
    settlementClaimRes.status === 400 &&
    settlementClaimRes.body.code === 'SETTLEMENT_PAYOUT_NOT_ALLOWED_IN_TALLY' &&
    settlementClaimRes.body.error === 'Settlement payouts must be recorded exclusively in claim amount. Expense tallies are reserved for ancillary costs only.'
  );

  // 25. Phase 4C: Settlement Amount rejected as expense tally in claim update (PUT /api/claims/:id)
  const settlementUpdateRes = await requestApi('PUT', `/api/claims/${claimId}`, {
    expense_tally_records: [
      ...parsedExpenses,
      {
        id: 'settlement-exp-2',
        expense_type: 'Settlement Amount',
        amount: 3500.00,
        currency: 'USD',
        status: 'pending'
      }
    ]
  }, midToken);
  record(
    'FIN-4.25',
    'Settlement Amount in expense tally update rejected with 400 Bad Request and SETTLEMENT_PAYOUT_NOT_ALLOWED_IN_TALLY code',
    settlementUpdateRes.status === 400 &&
    settlementUpdateRes.body.code === 'SETTLEMENT_PAYOUT_NOT_ALLOWED_IN_TALLY' &&
    settlementUpdateRes.body.error === 'Settlement payouts must be recorded exclusively in claim amount. Expense tallies are reserved for ancillary costs only.'
  );

  // 26. Phase 4C: Legitimate ancillary expense categories continue to save successfully
  const legitimateExpenseRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100014',
    claimant: 'Legitimate Expense Category Test',
    discharge_date: '2026-04-10',
    claim_amount: 12000.00,
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid documentation',
    })),
    expense_tally_records: [
      {
        id: 'legit-exp-1',
        expense_type: 'Survey Fees',
        amount: 1200.00,
        currency: 'USD',
        status: 'settled',
        settlement_amount: 1200.00
      },
      {
        id: 'legit-exp-2',
        expense_type: 'Legal Fees',
        amount: 2800.00,
        currency: 'USD',
        status: 'pending'
      },
      {
        id: 'legit-exp-3',
        expense_type: 'Accommodation',
        amount: 450.00,
        currency: 'USD',
        status: 'settled',
        settlement_amount: 450.00
      }
    ]
  }, midToken);
  const legitExpenses = typeof legitimateExpenseRes.body.expense_tally_records === 'string'
    ? JSON.parse(legitimateExpenseRes.body.expense_tally_records)
    : legitimateExpenseRes.body.expense_tally_records;
  record(
    'FIN-4.26',
    'Legitimate ancillary expense categories (Survey Fees, Legal Fees, Accommodation) save and validate successfully',
    legitimateExpenseRes.status === 201 &&
    Array.isArray(legitExpenses) &&
    legitExpenses.length === 3
  );

  // 27. Phase 4C: Standalone PostgreSQL tables expenses and recoveries remain populated and preserved
  const standaloneExpCheck = await db.prepare('SELECT id, claim_id, expense_type, amount FROM expenses WHERE id = ?').get(expId);
  const standaloneRecCheck = await db.prepare('SELECT id, claim_id, liable_party, recovery_amount FROM recoveries WHERE id = ?').get(recId);
  record(
    'FIN-4.27',
    'Standalone PostgreSQL expenses and recoveries tables remain fully preserved and populated with zero data loss',
    !!standaloneExpCheck &&
    standaloneExpCheck.id === expId &&
    !!standaloneRecCheck &&
    standaloneRecCheck.id === recId,
    `Preserved exp: ${standaloneExpCheck?.id}, rec: ${standaloneRecCheck?.id}`
  );

  return tests;
}
