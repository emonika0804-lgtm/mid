import { requestApi, TestItem } from './testApp';
import db, { pool } from '../server/src/db';
import {
  MANDATORY_DOCS_DRY_CLAIM,
  MANDATORY_DOCS_REEFER_CLAIM,
  MANDATORY_DOCS_DRY_SURVEY,
  MANDATORY_DOCS_REEFER_SURVEY,
  validateClaimMandatoryAttachments,
} from '../server/src/attachmentValidation';

export async function runSurveysSuite(): Promise<TestItem[]> {
  const tests: TestItem[] = [];
  function record(id: string, name: string, condition: boolean, details?: string) {
    tests.push({ id, name, pass: condition, details });
    console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${id}: ${name}${details ? ` -> ${details}` : ''}`);
  }

  console.log('\n--- SUITE 3: Comprehensive Survey Management Tests ---');

  const adminLogin = await requestApi('POST', '/api/auth/login', { email: 'admin@pilship.com', password: 'Password123!' });
  const adminToken = adminLogin.body.token;

  const midLogin = await requestApi('POST', '/api/auth/login', { email: 'mid@pilship.com', password: 'Password123!' });
  const midToken = midLogin.body.token;

  const agencyLogin = await requestApi('POST', '/api/auth/login', { email: 'agency@pilship.com', password: 'Password123!' });
  const agencyToken = agencyLogin.body.token;

  const agency2Login = await requestApi('POST', '/api/auth/login', { email: 'agency2@pilship.com', password: 'Password123!' });
  const agency2Token = agency2Login.body.token;

  // 1. Mandatory field validation
  const invalidSurveyRes = await requestApi('POST', '/api/surveys', {
    survey_requested_by: 'Consignee',
    // missing bl_number, survey_reference_number, date_of_survey, survey_cost
  }, agencyToken);
  record('SVY-3.1', 'Survey creation rejects incomplete submissions missing mandatory fields (400)', invalidSurveyRes.status === 400);

  // 2. Successful Survey Creation with valid Reefer mandatory attachments
  const surveyCreateRes = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100002',
    survey_reference_number: 'SRV-REF-9021',
    survey_requested_by: 'Shipper Representative',
    date_of_survey: '2026-05-15',
    survey_cost: 1850.00,
    request_coordinator: 'Kerutika',
    cargo_type: 'reefer',
    nature_of_damage_category: 'Temperature Abuse',
    nature_of_damage_reefer: 'Temperature Fluctuation',
    incident_description: 'Reefer set-point temperature variance detected during transit.',
    attachments: MANDATORY_DOCS_REEFER_SURVEY.map((doc) => ({
      type: doc,
      comment: 'Valid documentation verified during survey inspection',
    })),
  }, agencyToken);

  const survey1 = surveyCreateRes.body;
  record(
    'SVY-3.2',
    'Survey created successfully with auto-generated sequential number (SVY-YYYY-XXXX)',
    surveyCreateRes.status === 201 && typeof survey1.survey_number === 'string' && /^SVY-\d{4}-\d{4}$/.test(survey1.survey_number),
    `Survey Number: ${survey1.survey_number}`
  );

  // 3. Status updates: MID updates survey status to 'appointed'
  const updateSurveyRes = await requestApi('PUT', `/api/surveys/${survey1.id}`, {
    survey_status: 'appointed',
    cms_reference_number: 'CMS-SVY-2026-101',
  }, midToken);

  record(
    'SVY-3.3',
    'MID user updates survey status to "appointed" and assigns CMS reference number',
    updateSurveyRes.status === 200 && updateSurveyRes.body.survey_status === 'appointed' && updateSurveyRes.body.cms_reference_number === 'CMS-SVY-2026-101'
  );

  // 4. Survey-to-Claim Conversion: Agency user blocked (403 Forbidden)
  const agencyConvertRes = await requestApi('POST', `/api/surveys/${survey1.id}/convert-to-claim`, {}, agencyToken);
  record('SVY-3.4', 'Agency user blocked from converting survey to claim (403 Forbidden)', agencyConvertRes.status === 403);

  // 5. Survey-to-Claim Conversion: MID executes conversion
  const convertRes = await requestApi('POST', `/api/surveys/${survey1.id}/convert-to-claim`, {}, midToken);
  const createdClaimId = convertRes.body.claim_id;
  const createdClaimNumber = convertRes.body.claim_number;

  const claimFetchRes = await requestApi('GET', `/api/claims/${createdClaimId}`, null, midToken);
  const convertedClaim = claimFetchRes.body;

  record(
    'SVY-3.5',
    'MID converts survey to claim: creates new claim with originating survey linkage',
    convertRes.status === 200 &&
    Boolean(createdClaimNumber) &&
    convertedClaim?.originating_survey_id === survey1.id &&
    convertedClaim?.originating_survey_number === survey1.survey_number,
    `Converted Claim Number: ${createdClaimNumber}`
  );

  // 6. Survey converted_to_claim_id is populated
  const updatedSurvey = (await db.prepare('SELECT converted_to_claim_id FROM surveys WHERE id = ?').get(survey1.id)) as any;
  record('SVY-3.6', 'Survey record is permanently tagged with converted_to_claim_id', updatedSurvey?.converted_to_claim_id === createdClaimId);

  // 7. Duplicate conversion prevention
  const duplicateConvertRes = await requestApi('POST', `/api/surveys/${survey1.id}/convert-to-claim`, {}, midToken);
  record('SVY-3.7', 'Duplicate conversion of already converted survey is rejected (400 Bad Request)', duplicateConvertRes.status === 400);

  // 8. Survey status synchronization to linked claims
  const linkedClaimRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100003',
    claimant: 'Maritime Logistics Corp',
    discharge_date: '2026-06-01',
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Survey linked claim valid documentation',
    })),
  }, agencyToken);
  const linkedClaimId = linkedClaimRes.body.id;

  const linkedSurveyRes = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100003',
    survey_reference_number: 'SRV-LINK-44',
    survey_requested_by: 'Consignee',
    date_of_survey: '2026-06-02',
    survey_cost: 1200.00,
    claim_id: linkedClaimId,
    attachments: MANDATORY_DOCS_DRY_SURVEY.map((doc) => ({
      type: doc,
      comment: 'Survey dry test reason',
    })),
  }, agencyToken);
  const linkedSurveyId = linkedSurveyRes.body.id;

  // Verify Claim-to-Survey link immediately set survey_status = 'appointed' on claim
  const appointedClaim = (await db.prepare('SELECT survey_status FROM claims WHERE id = ?').get(linkedClaimId)) as any;
  record('SVY-3.8', 'Claim-to-Survey rerouting: creating survey linked to claim automatically updates claim survey_status to "appointed"', appointedClaim?.survey_status === 'appointed');

  // Updating survey status to 'rejected' synchronizes linked claim's survey_status to 'rejected'
  await requestApi('PUT', `/api/surveys/${linkedSurveyId}`, {
    survey_status: 'rejected',
  }, midToken);

  const checkedClaim = (await db.prepare('SELECT survey_status FROM claims WHERE id = ?').get(linkedClaimId)) as any;
  record('SVY-3.9', 'Survey status rejection automatically syncs survey_status = "rejected" on linked claim', checkedClaim?.survey_status === 'rejected');

  // =========================================================================
  // REGRESSION TESTS FOR PHASE 3 FIXES (SVY-3.10 to SVY-3.21)
  // =========================================================================

  // 10. Concurrency: Two simultaneous conversion requests for the same survey
  // Create a new appointed survey for simultaneous conversion test
  const simSurveyRes = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100004',
    survey_reference_number: 'SRV-CONCURR-1',
    survey_requested_by: 'Simultaneous Test Consignee',
    date_of_survey: '2026-07-01',
    survey_cost: 2100.00,
    cargo_type: 'dry',
    attachments: MANDATORY_DOCS_DRY_SURVEY.map((doc) => ({
      type: doc,
      comment: 'Simultaneous conversion test documentation',
    })),
  }, agencyToken);

  const simSurveyId = simSurveyRes.body.id;
  await requestApi('PUT', `/api/surveys/${simSurveyId}`, {
    survey_status: 'appointed',
    cms_reference_number: 'CMS-SIM-2026-01',
  }, midToken);

  // Execute two conversion requests concurrently in parallel
  const [simConvert1, simConvert2] = await Promise.all([
    requestApi('POST', `/api/surveys/${simSurveyId}/convert-to-claim`, {}, midToken),
    requestApi('POST', `/api/surveys/${simSurveyId}/convert-to-claim`, {}, midToken),
  ]);

  const simSuccesses = [simConvert1, simConvert2].filter((r) => r.status === 200);
  const simRejections = [simConvert1, simConvert2].filter((r) => r.status === 400);

  // Verify only 1 claim exists originating from simSurveyId
  const claimsForSimSurvey = (await db.prepare('SELECT id, claim_number FROM claims WHERE originating_survey_id = ?').all(simSurveyId)) as any[];

  record(
    'SVY-3.10',
    'Simultaneous conversion requests: row lock & transaction prevent duplicate claim creation',
    simSuccesses.length === 1 && simRejections.length === 1 && claimsForSimSurvey.length === 1,
    `Successes: ${simSuccesses.length}, Rejections: ${simRejections.length}, Claims created: ${claimsForSimSurvey.length}`
  );

  // 11. Repeated conversion request returns already-converted claim details
  const repeatedConvertRes = await requestApi('POST', `/api/surveys/${simSurveyId}/convert-to-claim`, {}, midToken);
  const repeatHandled =
    repeatedConvertRes.status === 400 &&
    repeatedConvertRes.body.already_converted === true &&
    repeatedConvertRes.body.claim_id === claimsForSimSurvey[0].id;

  record(
    'SVY-3.11',
    'Repeated conversion returns structured already-converted response referencing existing claim',
    repeatHandled,
    `Status: ${repeatedConvertRes.status}, Claim: ${repeatedConvertRes.body.claim_number}`
  );

  // 12. Mandatory survey attachment validation: missing key, empty, null, malformed
  const noAttSurvey = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100005',
    survey_reference_number: 'SRV-NO-ATT',
    survey_requested_by: 'Shipper',
    date_of_survey: '2026-07-02',
    survey_cost: 1500.00,
    cargo_type: 'dry',
  }, agencyToken);

  const emptyAttSurvey = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100005',
    survey_reference_number: 'SRV-EMPTY-ATT',
    survey_requested_by: 'Shipper',
    date_of_survey: '2026-07-02',
    survey_cost: 1500.00,
    cargo_type: 'dry',
    attachments: [],
  }, agencyToken);

  const nullAttSurvey = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100005',
    survey_reference_number: 'SRV-NULL-ATT',
    survey_requested_by: 'Shipper',
    date_of_survey: '2026-07-02',
    survey_cost: 1500.00,
    cargo_type: 'dry',
    attachments: null,
  }, agencyToken);

  const malformedAttSurvey = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100005',
    survey_reference_number: 'SRV-MALFORMED-ATT',
    survey_requested_by: 'Shipper',
    date_of_survey: '2026-07-02',
    survey_cost: 1500.00,
    cargo_type: 'dry',
    attachments: 'invalid-non-json-string',
  }, agencyToken);

  const attValidationUnconditional =
    noAttSurvey.status === 400 && noAttSurvey.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS' &&
    emptyAttSurvey.status === 400 && emptyAttSurvey.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS' &&
    nullAttSurvey.status === 400 && nullAttSurvey.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS' &&
    malformedAttSurvey.status === 400 && malformedAttSurvey.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS';

  record(
    'SVY-3.12',
    'Mandatory survey attachment validation is unconditional (missing, empty, null, malformed rejected with 400)',
    attValidationUnconditional,
    `No-att: ${noAttSurvey.status}, Empty: ${emptyAttSurvey.status}, Null: ${nullAttSurvey.status}, Malformed: ${malformedAttSurvey.status}`
  );

  // 13. Incomplete survey attachments rejected with missing document names (Dry 5 items)
  const incompleteDrySurvey = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100005',
    survey_reference_number: 'SRV-INCOMPLETE-DRY',
    survey_requested_by: 'Shipper',
    date_of_survey: '2026-07-02',
    survey_cost: 1500.00,
    cargo_type: 'dry',
    attachments: [
      { type: MANDATORY_DOCS_DRY_SURVEY[0], comment: 'Doc 1 reason' },
      { type: MANDATORY_DOCS_DRY_SURVEY[1], comment: 'Doc 2 reason' },
    ], // Missing 3 docs
  }, agencyToken);

  const incompleteDryRejected =
    incompleteDrySurvey.status === 400 &&
    incompleteDrySurvey.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS' &&
    Array.isArray(incompleteDrySurvey.body.missing_documents) &&
    incompleteDrySurvey.body.missing_documents.length === 3;

  record(
    'SVY-3.13',
    'Incomplete Dry survey attachments rejected (400) with list of missing documents',
    incompleteDryRejected,
    `Missing: ${incompleteDrySurvey.body.missing_documents?.length}`
  );

  // 14. Concurrent survey creation produces unique sequential numbers without collision
  const concurrentSurveyPayloads = [1, 2, 3].map((idx) => ({
    bl_number: `PIL010000${idx}`,
    survey_reference_number: `SRV-PARALLEL-${idx}`,
    survey_requested_by: `Parallel Claimant ${idx}`,
    date_of_survey: '2026-07-03',
    survey_cost: 1600.00 + idx * 100,
    cargo_type: 'dry',
    attachments: MANDATORY_DOCS_DRY_SURVEY.map((doc) => ({
      type: doc,
      comment: `Concurrent test attachment ${idx}`,
    })),
  }));

  const concurrentSurveyResults = await Promise.all(
    concurrentSurveyPayloads.map((p) => requestApi('POST', '/api/surveys', p, agencyToken))
  );

  const allSurveysCreated = concurrentSurveyResults.every((r) => r.status === 201);
  const surveyNumbers = concurrentSurveyResults.map((r) => r.body.survey_number);
  const uniqueSurveyNumbers = new Set(surveyNumbers);
  const allSurveyNumbersValid = surveyNumbers.every((n) => /^SVY-\d{4}-\d{4}$/.test(n));

  record(
    'SVY-3.14',
    'Concurrent survey creation: advisory lock generates unique sequential survey numbers without collision',
    allSurveysCreated && uniqueSurveyNumbers.size === 3 && allSurveyNumbersValid,
    `Assigned: ${surveyNumbers.join(', ')}`
  );

  // 15. Survey status whitelist enforcement on POST & Agency status injection blocking
  const agencyPrivilegedStatusPost = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100001',
    survey_reference_number: 'SRV-AGENCY-INJECT',
    survey_requested_by: 'Agency Inject Attempt',
    date_of_survey: '2026-07-04',
    survey_cost: 1400.00,
    cargo_type: 'dry',
    survey_status: 'appointed', // Attempt to bypass review
    attachments: MANDATORY_DOCS_DRY_SURVEY.map((doc) => ({
      type: doc,
      comment: 'Valid docs',
    })),
  }, agencyToken);

  const invalidStatusPost = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100001',
    survey_reference_number: 'SRV-INVALID-STATUS',
    survey_requested_by: 'Status Test',
    date_of_survey: '2026-07-04',
    survey_cost: 1400.00,
    cargo_type: 'dry',
    survey_status: 'unsupported_survey_status_xyz',
    cms_reference_number: 'CMS-TEST-01',
    attachments: MANDATORY_DOCS_DRY_SURVEY.map((doc) => ({
      type: doc,
      comment: 'Valid docs',
    })),
  }, midToken);

  const agencyStatusLocked = agencyPrivilegedStatusPost.status === 201 && agencyPrivilegedStatusPost.body.survey_status === 'new_survey';
  const invalidStatusRejected = invalidStatusPost.status === 400 && invalidStatusPost.body.error?.includes('Invalid survey status');

  record(
    'SVY-3.15',
    'Survey status validation: agency locked to "new_survey"; unsupported status rejected (400)',
    agencyStatusLocked && invalidStatusRejected,
    `Agency assigned: ${agencyPrivilegedStatusPost.body.survey_status}, Invalid status code: ${invalidStatusPost.status}`
  );

  // 16. Unsupported status submitted via PUT rejected with 400
  const createdTestSurveyId = agencyPrivilegedStatusPost.body.id;
  const invalidStatusPut = await requestApi('PUT', `/api/surveys/${createdTestSurveyId}`, {
    survey_status: 'malformed_status_999',
  }, midToken);

  const validStatusPut = await requestApi('PUT', `/api/surveys/${createdTestSurveyId}`, {
    survey_status: 'pending',
  }, midToken);

  record(
    'SVY-3.16',
    'Survey status whitelist on PUT: invalid status rejected (400); supported status accepted (200)',
    invalidStatusPut.status === 400 && validStatusPut.status === 200 && validStatusPut.body.survey_status === 'pending',
    `Invalid PUT: ${invalidStatusPut.status}, Valid PUT: ${validStatusPut.status}`
  );

  // 17. Comprehensive survey edit audit logging: records changed fields with exact old/new values, skips unchanged fields
  const auditEditRes = await requestApi('PUT', `/api/surveys/${createdTestSurveyId}`, {
    survey_cost: 2999.50,
    request_coordinator: 'Alfred Wei',
    incident_description: 'Updated incident description detailing significant cargo loss during sea storm.',
    selected_containers: ['PCIU1122334', 'PCIU9988776'],
  }, midToken);

  // Retrieve audit records via both HTTP endpoint and direct database query
  const auditFetchRes = await requestApi('GET', `/api/surveys/${createdTestSurveyId}/audit`, null, midToken);
  const httpAuditLogs = Array.isArray(auditFetchRes.body) ? auditFetchRes.body : [];
  const dbAuditRows = (await db.prepare('SELECT * FROM audit_logs WHERE entity_id = ? ORDER BY created_date ASC').all(createdTestSurveyId)) as any[];

  // Locate persisted entries for each updated field
  const costAuditDb = dbAuditRows.find((a: any) => a.field_changed === 'survey_cost');
  const coordAuditDb = dbAuditRows.find((a: any) => a.field_changed === 'request_coordinator');
  const incidentAuditDb = dbAuditRows.find((a: any) => a.field_changed === 'incident_description');
  const containersAuditDb = dbAuditRows.find((a: any) => a.field_changed === 'selected_containers');

  const costAuditHttp = httpAuditLogs.find((a: any) => a.field_changed === 'survey_cost');
  const coordAuditHttp = httpAuditLogs.find((a: any) => a.field_changed === 'request_coordinator');
  const incidentAuditHttp = httpAuditLogs.find((a: any) => a.field_changed === 'incident_description');
  const containersAuditHttp = httpAuditLogs.find((a: any) => a.field_changed === 'selected_containers');

  // Verify exact persisted old_value and new_value matches in database
  const costValuesExact = costAuditDb?.old_value === '1400' && costAuditDb?.new_value === '2999.5';
  const coordValuesExact = coordAuditDb?.old_value === '' && coordAuditDb?.new_value === 'Alfred Wei';
  const incidentValuesExact =
    incidentAuditDb?.old_value === '' &&
    incidentAuditDb?.new_value === 'Updated incident description detailing significant cargo loss during sea storm.';
  const containersValuesExact =
    containersAuditDb?.old_value === '[]' &&
    containersAuditDb?.new_value === '["PCIU1122334","PCIU9988776"]';

  // Verify HTTP endpoint faithfully reflects the persisted DB records
  const httpMatchesDb =
    costAuditHttp?.old_value === costAuditDb?.old_value && costAuditHttp?.new_value === costAuditDb?.new_value &&
    coordAuditHttp?.old_value === coordAuditDb?.old_value && coordAuditHttp?.new_value === coordAuditDb?.new_value &&
    incidentAuditHttp?.old_value === incidentAuditDb?.old_value && incidentAuditHttp?.new_value === incidentAuditDb?.new_value &&
    containersAuditHttp?.old_value === containersAuditDb?.old_value && containersAuditHttp?.new_value === containersAuditDb?.new_value;

  // Verify unchanged fields strictly have no audit entry
  const auditedFieldNames = dbAuditRows.map((a: any) => a.field_changed).filter(Boolean);
  const unchangedFields = [
    'bl_number',
    'survey_reference_number',
    'survey_requested_by',
    'date_of_survey',
    'cargo_type',
    'cms_reference_number',
    'place_of_incident',
    'date_of_incident',
    'nature_of_damage_type',
    'containers_with_sizes',
  ];
  const noUnchangedFieldsLogged = unchangedFields.every((f) => !auditedFieldNames.includes(f));

  const comprehensiveSurveyAudit =
    auditEditRes.status === 200 &&
    costValuesExact &&
    coordValuesExact &&
    incidentValuesExact &&
    containersValuesExact &&
    httpMatchesDb &&
    noUnchangedFieldsLogged;

  record(
    'SVY-3.17',
    'Comprehensive survey edit audit logging: captures changed fields with exact old/new values, strictly omits unchanged fields',
    comprehensiveSurveyAudit,
    `Cost: ${costAuditDb?.old_value}->${costAuditDb?.new_value}, Coord: "${coordAuditDb?.old_value}"->"${coordAuditDb?.new_value}", Containers: ${containersAuditDb?.old_value}->${containersAuditDb?.new_value}, Unchanged skipped: ${noUnchangedFieldsLogged}`
  );

  // 18. Agency audit access RLS isolation: owned survey allowed (200), unowned blocked (403), missing returns 404
  const agency1SurveyAudit = await requestApi('GET', `/api/surveys/${createdTestSurveyId}/audit`, null, agencyToken);
  const agency2SurveyAudit = await requestApi('GET', `/api/surveys/${createdTestSurveyId}/audit`, null, agency2Token);
  const missingSurveyAudit = await requestApi('GET', '/api/surveys/non-existent-survey-999/audit', null, adminToken);

  const auditRlsValid =
    agency1SurveyAudit.status === 200 && Array.isArray(agency1SurveyAudit.body) &&
    agency2SurveyAudit.status === 403 && agency2SurveyAudit.body.error?.includes('Access denied') &&
    missingSurveyAudit.status === 404;

  record(
    'SVY-3.18',
    'Survey audit trail enforces RLS: Agency 1 views owned (200), Agency 2 blocked (403), missing returns 404',
    auditRlsValid,
    `Owner: ${agency1SurveyAudit.status}, Non-owner: ${agency2SurveyAudit.status}, Missing: ${missingSurveyAudit.status}`
  );

  // 19. Converted claim mandatory-document compatibility (Dry claim satisfying Dry 13 requirements)
  const drySurveyForConvert = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100007',
    survey_reference_number: 'SRV-DRY-COMPAT-1',
    survey_requested_by: 'Dry Cargo Owner',
    date_of_survey: '2026-07-10',
    survey_cost: 1900.00,
    cargo_type: 'dry',
    attachments: [
      {
        type: 'Commercial Invoice',
        file_url: '/api/files/stored_invoice.pdf',
        stored_filename: 'stored_invoice.pdf',
        file_name: 'invoice.pdf',
      },
      ...MANDATORY_DOCS_DRY_SURVEY.filter((d) => d !== 'Commercial Invoice').map((d) => ({
        type: d,
        comment: `Dry survey note for ${d}`,
      })),
    ],
  }, agencyToken);

  const drySurveyId = drySurveyForConvert.body.id;
  await requestApi('PUT', `/api/surveys/${drySurveyId}`, {
    survey_status: 'appointed',
    cms_reference_number: 'CMS-DRY-2026-99',
  }, midToken);

  const convertDryRes = await requestApi('POST', `/api/surveys/${drySurveyId}/convert-to-claim`, {}, midToken);
  const convertedDryClaimId = convertDryRes.body.claim_id;

  const getConvertedDryClaim = await requestApi('GET', `/api/claims/${convertedDryClaimId}`, null, midToken);
  const convertedDryAttachments = getConvertedDryClaim.body.attachments || [];

  // Evaluate the converted claim attachments against universal claim mandatory validation
  const dryValidationResult = validateClaimMandatoryAttachments(convertedDryAttachments, 'dry');

  // Verify that Commercial Invoice retained its uploaded file and missing claim docs received conversion comment
  const invoiceAtt = convertedDryAttachments.find((a: any) => a.type === 'Commercial Invoice');
  const hasInvoiceFile = Boolean(invoiceAtt?.file_url === '/api/files/stored_invoice.pdf');
  const nonSurveyDoc = convertedDryAttachments.find((a: any) => a.type === 'Claim Statement with Breakdown');
  const hasConversionComment = typeof nonSurveyDoc?.comment === 'string' && nonSurveyDoc.comment.includes('survey conversion');

  record(
    'SVY-3.19',
    'Converted Dry claim satisfies 13 mandatory document requirements: preserves files and initializes pending notes',
    convertDryRes.status === 200 && dryValidationResult.valid && hasInvoiceFile && hasConversionComment,
    `Claim attachments count: ${convertedDryAttachments.length}, Valid: ${dryValidationResult.valid}`
  );

  // 20. Converted Reefer claim mandatory-document compatibility (satisfying Reefer 16 requirements)
  const reeferSurveyForConvert = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100008',
    survey_reference_number: 'SRV-REEFER-COMPAT-1',
    survey_requested_by: 'Reefer Consignee',
    date_of_survey: '2026-07-11',
    survey_cost: 2500.00,
    cargo_type: 'reefer',
    attachments: MANDATORY_DOCS_REEFER_SURVEY.map((doc) => ({
      type: doc,
      comment: `Reefer survey inspection note for ${doc}`,
    })),
  }, agencyToken);

  const reeferSurveyId = reeferSurveyForConvert.body.id;
  await requestApi('PUT', `/api/surveys/${reeferSurveyId}`, {
    survey_status: 'appointed',
    cms_reference_number: 'CMS-REEFER-2026-77',
  }, midToken);

  const convertReeferRes = await requestApi('POST', `/api/surveys/${reeferSurveyId}/convert-to-claim`, {}, midToken);
  const convertedReeferClaimId = convertReeferRes.body.claim_id;

  const getConvertedReeferClaim = await requestApi('GET', `/api/claims/${convertedReeferClaimId}`, null, midToken);
  const convertedReeferAttachments = getConvertedReeferClaim.body.attachments || [];

  const reeferValidationResult = validateClaimMandatoryAttachments(convertedReeferAttachments, 'reefer');

  record(
    'SVY-3.20',
    'Converted Reefer claim satisfies 16 mandatory document requirements across Dry base and Reefer items',
    convertReeferRes.status === 200 && reeferValidationResult.valid,
    `Reefer attachments count: ${convertedReeferAttachments.length}, Valid: ${reeferValidationResult.valid}`
  );

  // 21. Converted claim is fully editable without failing claim-stage validation
  const editConvertedClaimRes = await requestApi('PUT', `/api/claims/${convertedDryClaimId}`, {
    claimant: 'Updated Maritime Claimant Ltd',
    incident_description: 'Updated claim description following joint survey conversion',
  }, midToken);

  record(
    'SVY-3.21',
    'Converted claim can be edited and saved without failing mandatory attachment validation (200 OK)',
    editConvertedClaimRes.status === 200 && editConvertedClaimRes.body.claimant === 'Updated Maritime Claimant Ltd',
    `Status: ${editConvertedClaimRes.status}, Claimant: ${editConvertedClaimRes.body.claimant}`
  );

  // 22. Controlled mid-transaction DB failure: complete rollback leaves no orphan claim or audit logs; connection released
  const rollbackSurveyRes = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100099',
    survey_reference_number: 'SRV-ROLLBACK-TEST',
    survey_requested_by: 'Rollback Test Claimant',
    date_of_survey: '2026-07-20',
    survey_cost: 3200.00,
    cargo_type: 'dry',
    attachments: MANDATORY_DOCS_DRY_SURVEY.map((doc) => ({
      type: doc,
      comment: 'Rollback test documentation note',
    })),
  }, agencyToken);

  const rollbackSurveyId = rollbackSurveyRes.body.id;
  await requestApi('PUT', `/api/surveys/${rollbackSurveyId}`, {
    survey_status: 'appointed',
    cms_reference_number: 'CMS-RB-2026-01',
  }, midToken);

  // In convert-to-claim, INSERT INTO claims executes before audit log insertion.
  // Install a temporary PostgreSQL trigger on audit_logs that raises an exception when the conversion audit row is inserted.
  await pool.query(`
    CREATE OR REPLACE FUNCTION trg_fail_on_conversion_audit() RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.entity_id = '${rollbackSurveyId}' AND NEW.action = 'CONVERT' THEN
        RAISE EXCEPTION 'CONTROLLED_INJECTED_FAILURE_AFTER_CLAIM_INSERT';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS trg_test_fail_conversion ON audit_logs;
    CREATE TRIGGER trg_test_fail_conversion
    BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION trg_fail_on_conversion_audit();
  `);

  let injectedConvertFailed = false;
  try {
    const convertFailRes = await requestApi('POST', `/api/surveys/${rollbackSurveyId}/convert-to-claim`, {}, midToken);
    injectedConvertFailed = convertFailRes.status === 500;
  } finally {
    // Strictly drop the temporary trigger and trigger function
    await pool.query('DROP TRIGGER IF EXISTS trg_test_fail_conversion ON audit_logs');
    await pool.query('DROP FUNCTION IF EXISTS trg_fail_on_conversion_audit');
  }

  // 1. Verify no orphan claim remains
  const orphanClaims = (await db.prepare('SELECT id, claim_number FROM claims WHERE originating_survey_id = ?').all(rollbackSurveyId)) as any[];
  const noOrphanClaim = orphanClaims.length === 0;

  // 2. Verify survey.converted_to_claim_id remains unchanged (null)
  const surveyAfterRollback = (await db.prepare('SELECT id, survey_status, converted_to_claim_id, converted_to_claim_number FROM surveys WHERE id = ?').get(rollbackSurveyId)) as any;
  const surveyUnchanged =
    surveyAfterRollback &&
    surveyAfterRollback.converted_to_claim_id === null &&
    surveyAfterRollback.converted_to_claim_number === null &&
    surveyAfterRollback.survey_status === 'appointed';

  // 3. Verify neither conversion audit entry remains
  const rollbackSurveyNumber = rollbackSurveyRes.body.survey_number;
  const surveyConvertAudit = (await db.prepare(
    "SELECT id, entity_type, action, details FROM audit_logs WHERE entity_id = ? AND action = 'CONVERT'"
  ).all(rollbackSurveyId)) as any[];
  const claimCreatedAudit = (await db.prepare(
    "SELECT id, entity_type, action, details FROM audit_logs WHERE action = 'CREATE' AND details LIKE ?"
  ).all(`%from Survey ${rollbackSurveyNumber}%`)) as any[];
  const noConversionAudit = surveyConvertAudit.length === 0 && claimCreatedAudit.length === 0;

  // 4. Verify database connection was released and can be reused
  let connectionReused = false;
  try {
    const checkClient = await pool.connect();
    const pingRes = await checkClient.query('SELECT 1 as alive');
    connectionReused = pingRes.rows[0]?.alive === 1;
    checkClient.release();
  } catch {
    connectionReused = false;
  }

  // 5. Verify the survey can be converted successfully now that the injected failure is removed
  const recoverConvertRes = await requestApi('POST', `/api/surveys/${rollbackSurveyId}/convert-to-claim`, {}, midToken);
  const conversionRecovered = recoverConvertRes.status === 200 && Boolean(recoverConvertRes.body.claim_id);

  const fullRollbackVerified =
    injectedConvertFailed &&
    noOrphanClaim &&
    surveyUnchanged &&
    noConversionAudit &&
    connectionReused &&
    conversionRecovered;

  record(
    'SVY-3.22',
    'Controlled mid-transaction DB failure: complete rollback leaves no orphan claim or audit logs; connection safely released',
    fullRollbackVerified,
    `500 Triggered: ${injectedConvertFailed}, Orphan claims: ${orphanClaims.length}, Survey untouched: ${Boolean(surveyUnchanged)}, Audits: ${surveyConvertAudit.length + claimCreatedAudit.length}, Connection reused: ${connectionReused}, Recovery: ${conversionRecovered}`
  );

  return tests;
}
