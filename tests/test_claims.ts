import { requestApi, TestItem } from './testApp';
import db from '../server/src/db';
import {
  MANDATORY_DOCS_DRY_CLAIM,
  MANDATORY_DOCS_REEFER_CLAIM,
} from '../server/src/attachmentValidation';

export async function runClaimsSuite(): Promise<TestItem[]> {
  const tests: TestItem[] = [];
  function record(id: string, name: string, condition: boolean, details?: string) {
    tests.push({ id, name, pass: condition, details });
    console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${id}: ${name}${details ? ` -> ${details}` : ''}`);
  }

  console.log('\n--- SUITE 2: Comprehensive Claim Management Tests ---');

  // Authenticate test users
  const adminLogin = await requestApi('POST', '/api/auth/login', { email: 'admin@pilship.com', password: 'Password123!' });
  const adminToken = adminLogin.body.token;

  const agency1Login = await requestApi('POST', '/api/auth/login', { email: 'agency@pilship.com', password: 'Password123!' });
  const agency1Token = agency1Login.body.token;

  const agency2Login = await requestApi('POST', '/api/auth/login', { email: 'agency2@pilship.com', password: 'Password123!' });
  const agency2Token = agency2Login.body.token;

  const midLogin = await requestApi('POST', '/api/auth/login', { email: 'mid@pilship.com', password: 'Password123!' });
  const midToken = midLogin.body.token;

  // 1. Mandatory field validation: missing bl_number
  const noBlRes = await requestApi('POST', '/api/claims', {
    claimant: 'Acme Logistics',
    discharge_date: '2026-05-10',
  }, agency1Token);
  record('CLM-2.1', 'Claim creation without bl_number rejected (400 Bad Request)', noBlRes.status === 400);

  // 2. Mandatory field validation: missing claimant
  const noClaimantRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100001',
    discharge_date: '2026-05-10',
  }, agency1Token);
  record('CLM-2.2', 'Claim creation without claimant rejected (400 Bad Request)', noClaimantRes.status === 400);

  // 3. LMS Lookup verification for auto-population
  const lmsLookupRes = await requestApi('GET', '/api/lms/lookup?bl_number=PIL0100001', null, agency1Token);
  record(
    'CLM-2.3',
    'LMS shipment lookup returns shipper, consignee, port, and container details',
    lmsLookupRes.status === 200 && Boolean(lmsLookupRes.body.data?.shipper) && Array.isArray(lmsLookupRes.body.containers)
  );

  // 4. Create Claim by Agency 1
  const createClaimRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100001',
    claimant: 'Apex Global Cargo Ltd',
    claimant_type: 'Cargo Insurer',
    shipper: lmsLookupRes.body.data.shipper,
    consignee: lmsLookupRes.body.data.consignee,
    port_of_loading: lmsLookupRes.body.data.port_of_loading,
    port_of_discharge: lmsLookupRes.body.data.port_of_discharge,
    vessel_name: lmsLookupRes.body.data.vessel_name,
    commodity: 'Electronics & Optical Components',
    cargo_type: 'dry',
    discharge_date: '2026-05-01',
    claim_amount: 12500.50,
    selected_containers: ['PCIU1234567'],
    containers_with_sizes: [{ container_number: 'PCIU1234567', container_size: '40ft HC' }],
    incident_description: 'Water ingress resulting in severe package soaking and physical distortion.',
    date_of_incident: '2026-05-02',
    place_of_incident: 'Port Terminal Yard',
    nature_of_damage_category: 'Wet Cargo',
    nature_of_damage_type: 'Water Ingress',
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid documentation on file for test',
    })),
  }, agency1Token);

  const claim1 = createClaimRes.body;
  record(
    'CLM-2.4',
    'Agency successfully creates claim with auto-generated sequential number (CLM-YYYY-XXXX)',
    createClaimRes.status === 201 && typeof claim1.claim_number === 'string' && /^CLM-\d{4}-\d{4}$/.test(claim1.claim_number),
    `Claim Number: ${claim1.claim_number}`
  );

  // 5. Automatic time bar calculation (1 year from discharge_date)
  record(
    'CLM-2.5',
    'Time bar automatically calculated as 1 year from discharge date',
    typeof claim1.time_bar_date === 'string' && claim1.time_bar_date.startsWith('2027-05-01'),
    `Time Bar: ${claim1.time_bar_date}`
  );

  // 6. Public Agency role locked to status 'new_claim' on creation
  record('CLM-2.6', 'Agency creation locks initial status to "new_claim" and cms_number to null', claim1.status === 'new_claim' && claim1.cms_number === null);

  // 7. Audit log automatically generated on creation
  const auditLogs = await requestApi('GET', `/api/claims/${claim1.id}/audit`, null, agency1Token);
  record('CLM-2.7', 'Claim creation automatically generates audit log entry', auditLogs.status === 200 && auditLogs.body.some((l: any) => l.action === 'CREATE'));

  // 8. Notification created on claim creation
  const agencyNotifications = await requestApi('GET', '/api/notifications', null, agency1Token);
  record('CLM-2.8', 'New claim submission generates in-app notification', agencyNotifications.status === 200 && agencyNotifications.body.some((n: any) => n.claim_id === claim1.id));

  // 9. Agency 2 CANNOT access Agency 1 claim (RLS isolation)
  const agency2GetRes = await requestApi('GET', `/api/claims/${claim1.id}`, null, agency2Token);
  record('CLM-2.9', 'Agency 2 blocked from viewing Agency 1 claim (403 Forbidden)', agency2GetRes.status === 403);

  // 10. Agency 2 queue does NOT include Agency 1 claim
  const agency2Queue = await requestApi('GET', '/api/claims', null, agency2Token);
  const leakedInQueue = agency2Queue.body.some((c: any) => c.id === claim1.id);
  record('CLM-2.10', 'Agency queue query completely isolates records (Agency 2 sees 0 unowned claims)', !leakedInQueue);

  // 11. Agency 1 cannot update CMS number or status (MID-only permissions)
  const agencyEditStatus = await requestApi('PUT', `/api/claims/${claim1.id}`, {
    status: 'in_progress',
    cms_number: 'CMS-UNAUTHORIZED-999',
  }, agency1Token);
  record('CLM-2.11', 'Agency cannot unilaterally change status or assign CMS number', agencyEditStatus.body.status === 'new_claim' && agencyEditStatus.body.cms_number === null);

  // 12. MID Handler updates claim: assigns CMS number, handler, and advances status
  const midEditRes = await requestApi('PUT', `/api/claims/${claim1.id}`, {
    cms_number: 'CMS-2026-0881',
    claims_handler: 'Alfred',
    status: 'in_progress',
    claim_amount: 14000.00, // Amount changed to test history tracking
  }, midToken);

  record(
    'CLM-2.12',
    'MID user successfully updates CMS number, assigns claims handler, and changes status',
    midEditRes.status === 200 && midEditRes.body.cms_number === 'CMS-2026-0881' && midEditRes.body.claims_handler === 'Alfred' && midEditRes.body.status === 'in_progress'
  );

  // 13. Claim amount history tracking
  const updatedClaim = midEditRes.body;
  record(
    'CLM-2.13',
    'Claim amount modification is tracked in claim_amount_history array',
    Array.isArray(updatedClaim.claim_amount_history) && updatedClaim.claim_amount_history.length >= 2,
    `History entries: ${updatedClaim.claim_amount_history?.length}`
  );

  // 14. Audit history verifies field-level change tracking
  const updatedAuditLogs = await requestApi('GET', `/api/claims/${claim1.id}/audit`, null, midToken);
  const hasCmsAudit = updatedAuditLogs.body.some((l: any) => l.field_changed === 'cms_number' && l.new_value === 'CMS-2026-0881');
  const hasHandlerAudit = updatedAuditLogs.body.some((l: any) => l.field_changed === 'claims_handler' && l.new_value === 'Alfred');
  record('CLM-2.14', 'Audit trail accurately records field-level changes with old and new values', hasCmsAudit && hasHandlerAudit);

  // 15. SLA calculation reflects status
  record('CLM-2.15', 'SLA calculation engine computes green status for active un-expired claim', updatedClaim.sla_status === 'green');

  // 16. Comments addition
  const commentRes = await requestApi('PUT', `/api/claims/${claim1.id}`, {
    comments: [{ id: 'comm-1', user_name: 'Alfred', text: 'Requested official surveyor inspection report.', timestamp: new Date().toISOString() }],
  }, midToken);
  record('CLM-2.16', 'Internal comments successfully appended to claim', commentRes.status === 200 && commentRes.body.comments.length === 1);

  // 17. Agency cannot delete claim
  const agencyDeleteRes = await requestApi('DELETE', `/api/claims/${claim1.id}`, null, agency1Token);
  record('CLM-2.17', 'Agency user denied permission to delete claims (403 Forbidden)', agencyDeleteRes.status === 403);

  // 18. MID / Admin can access all claims
  const adminClaims = await requestApi('GET', '/api/claims', null, adminToken);
  record('CLM-2.18', 'Admin and MID users can query all claims across agencies', adminClaims.status === 200 && adminClaims.body.some((c: any) => c.id === claim1.id));

  // 19. Claim Audit Trail IDOR Protection: Agency 2 CANNOT access Agency 1 claim audit trail
  const agency2AuditRes = await requestApi('GET', `/api/claims/${claim1.id}/audit`, null, agency2Token);
  record(
    'CLM-2.19',
    'Claim audit trail enforces RLS: Agency 2 denied access to Agency 1 audit logs (403 Forbidden)',
    agency2AuditRes.status === 403 && agency2AuditRes.body.error?.includes('Access denied'),
    `Status: ${agency2AuditRes.status}`
  );

  // 20. Claim Audit Trail Privileged & Owner Access: Agency 1 (owner), MID, Admin can access; 404 for missing claim
  const agency1AuditRes = await requestApi('GET', `/api/claims/${claim1.id}/audit`, null, agency1Token);
  const midAuditRes = await requestApi('GET', `/api/claims/${claim1.id}/audit`, null, midToken);
  const adminAuditRes = await requestApi('GET', `/api/claims/${claim1.id}/audit`, null, adminToken);
  const notFoundAuditRes = await requestApi('GET', '/api/claims/non-existent-claim-id-999/audit', null, adminToken);

  const auditAccessValid =
    agency1AuditRes.status === 200 && Array.isArray(agency1AuditRes.body) &&
    midAuditRes.status === 200 && Array.isArray(midAuditRes.body) &&
    adminAuditRes.status === 200 && Array.isArray(adminAuditRes.body) &&
    notFoundAuditRes.status === 404;

  record(
    'CLM-2.20',
    'Claim audit trail allows claim owner (Agency 1), MID, and Admin access; returns 404 for non-existent claim',
    auditAccessValid,
    `Owner: ${agency1AuditRes.status}, MID: ${midAuditRes.status}, Admin: ${adminAuditRes.status}, 404 check: ${notFoundAuditRes.status}`
  );

  // 21. Server-side atomic claim number generation: client-supplied claim_number ignored
  const forgedClaimRes = await requestApi('POST', '/api/claims', {
    claim_number: 'CLM-FORGED-9999',
    bl_number: 'PIL0100001',
    claimant: 'Client Overwrite Attempt Ltd',
    cargo_type: 'dry',
    discharge_date: '2026-05-01',
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid documentation on file for test',
    })),
  }, agency1Token);

  const forgedClaimBody = forgedClaimRes.body;
  const serverGenerated =
    forgedClaimRes.status === 201 &&
    forgedClaimBody.claim_number !== 'CLM-FORGED-9999' &&
    /^CLM-\d{4}-\d{4}$/.test(forgedClaimBody.claim_number);

  record(
    'CLM-2.21',
    'Client-supplied claim_number during POST is strictly ignored in favor of server-generated sequential number',
    serverGenerated,
    `Assigned: ${forgedClaimBody.claim_number}`
  );

  // 22. Concurrency-safe claim number generation (parallel creation produces unique sequential numbers)
  const concurrentPayloads = [1, 2, 3].map((idx) => ({
    bl_number: `PIL010000${idx}`,
    claimant: `Concurrent Claimant ${idx}`,
    cargo_type: 'dry',
    discharge_date: '2026-05-01',
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: `Concurrent test attachment ${idx}`,
    })),
  }));

  const concurrentResults = await Promise.all(
    concurrentPayloads.map((p) => requestApi('POST', '/api/claims', p, agency1Token))
  );

  const allCreated = concurrentResults.every((r) => r.status === 201);
  const claimNumbers = concurrentResults.map((r) => r.body.claim_number);
  const uniqueNumbers = new Set(claimNumbers);
  const allFormatted = claimNumbers.every((n) => /^CLM-\d{4}-\d{4}$/.test(n));

  record(
    'CLM-2.22',
    'Concurrent claim creations generate unique sequential numbers without collision',
    allCreated && uniqueNumbers.size === 3 && allFormatted,
    `Numbers: ${claimNumbers.join(', ')}`
  );

  // 23. Mandatory attachment validation on every claim creation (unconditional enforcement)
  const noAttRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100001',
    claimant: 'No Attachments Ltd',
    cargo_type: 'dry',
    discharge_date: '2026-05-01',
  }, agency1Token);

  const emptyAttRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100001',
    claimant: 'Empty Attachments Ltd',
    cargo_type: 'dry',
    discharge_date: '2026-05-01',
    attachments: [],
  }, agency1Token);

  const attValidationEnforced =
    noAttRes.status === 400 &&
    noAttRes.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS' &&
    emptyAttRes.status === 400 &&
    emptyAttRes.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS';

  record(
    'CLM-2.23',
    'Missing attachments key or empty attachments array during POST is rejected (400 INCOMPLETE_MANDATORY_ATTACHMENTS)',
    attValidationEnforced,
    `No-key: ${noAttRes.status}, Empty: ${emptyAttRes.status}`
  );

  // 24. Mandatory attachment validation for Reefer claims (16 required documents)
  const reeferDryOnlyRes = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100001',
    claimant: 'Reefer Pharma Corp',
    cargo_type: 'reefer',
    discharge_date: '2026-05-01',
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Only dry documents provided',
    })),
  }, agency1Token);

  const reeferEnforced =
    reeferDryOnlyRes.status === 400 &&
    reeferDryOnlyRes.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS' &&
    Array.isArray(reeferDryOnlyRes.body.missing_documents) &&
    reeferDryOnlyRes.body.missing_documents.length === 3;

  record(
    'CLM-2.24',
    'Reefer claim creation missing Reefer-specific documents is rejected with 400 and list of missing docs',
    reeferEnforced,
    `Missing count: ${reeferDryOnlyRes.body.missing_documents?.length}`
  );

  // 25. Claim status whitelist enforcement (POST and PUT)
  const invalidStatusPost = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100001',
    claimant: 'Status Whitelist Test',
    status: 'unsupported_status_xyz',
    cargo_type: 'dry',
    discharge_date: '2026-05-01',
    attachments: MANDATORY_DOCS_DRY_CLAIM.map((doc) => ({
      type: doc,
      comment: 'Valid docs',
    })),
  }, midToken);

  const invalidStatusPut = await requestApi('PUT', `/api/claims/${claim1.id}`, {
    status: 'fake_status_123',
  }, midToken);

  const validStatusPut = await requestApi('PUT', `/api/claims/${claim1.id}`, {
    status: 'awaiting_approval',
  }, midToken);

  const statusWhitelistEnforced =
    invalidStatusPost.status === 400 &&
    invalidStatusPut.status === 400 &&
    validStatusPut.status === 200 &&
    validStatusPut.body.status === 'awaiting_approval';

  record(
    'CLM-2.25',
    'Claim status whitelist: unknown status rejected (400 Bad Request); supported status accepted',
    statusWhitelistEnforced,
    `Invalid POST: ${invalidStatusPost.status}, Invalid PUT: ${invalidStatusPut.status}, Valid PUT: ${validStatusPut.status}`
  );

  // 26. Comprehensive claim edit audit logging: tracking changes across all key claim fields
  const comprehensiveEditRes = await requestApi('PUT', `/api/claims/${claim1.id}`, {
    claimant: 'Apex Global Logistics Holdings Pte Ltd',
    claimant_type: 'Shipper',
    incident_description: 'Updated incident: heavy sea surge caused container shift and structural rupture.',
    place_of_incident: 'High Seas - Pacific Route',
    selected_containers: ['PCIU1234567', 'PCIU7654321'],
    policy_number: 'POL-PIL-2026-X9',
    policy_pi_club: 'Britannia P&I',
    policy_deductible_usd: 5000.00,
  }, midToken);

  const comprehensiveAuditRes = await requestApi('GET', `/api/claims/${claim1.id}/audit`, null, midToken);
  const auditList = Array.isArray(comprehensiveAuditRes.body) ? comprehensiveAuditRes.body : [];

  const auditedFields = auditList.map((a: any) => a.field_changed);
  const hasClaimantAudit = auditedFields.includes('claimant');
  const hasIncidentAudit = auditedFields.includes('incident_description');
  const hasPlaceAudit = auditedFields.includes('place_of_incident');
  const hasContainersAudit = auditedFields.includes('selected_containers');
  const hasPolicyDeductibleAudit = auditedFields.includes('policy_deductible_usd');

  const comprehensiveAuditTracked =
    comprehensiveEditRes.status === 200 &&
    hasClaimantAudit &&
    hasIncidentAudit &&
    hasPlaceAudit &&
    hasContainersAudit &&
    hasPolicyDeductibleAudit;

  record(
    'CLM-2.26',
    'Comprehensive claim edit audit logging captures claimant, incident, container, and policy changes',
    comprehensiveAuditTracked,
    `Audited fields: ${[...new Set(auditedFields)].join(', ')}`
  );

  // 27. Atomic update transaction integrity
  const auditedClaimantEntry = auditList.find((a: any) => a.field_changed === 'claimant');
  const atomicCommitted =
    comprehensiveEditRes.body.claimant === 'Apex Global Logistics Holdings Pte Ltd' &&
    auditedClaimantEntry?.new_value === 'Apex Global Logistics Holdings Pte Ltd';

  record(
    'CLM-2.27',
    'Atomic update transaction commits claim row updates and all audit log entries consistently',
    atomicCommitted,
    `Claim claimant: ${comprehensiveEditRes.body.claimant}`
  );

  return tests;
}
