import { requestApi, TestItem } from './testApp';
import {
  MANDATORY_DOCS_DRY_CLAIM,
  MANDATORY_DOCS_REEFER_CLAIM,
  MANDATORY_DOCS_DRY_SURVEY,
  MANDATORY_DOCS_REEFER_SURVEY,
  validateClaimMandatoryAttachments,
  validateSurveyMandatoryAttachments,
  hasValidUpload,
  hasValidReason,
  isDocMatching,
} from '../server/src/attachmentValidation';

export async function runMandatoryAttachmentsSuite(): Promise<TestItem[]> {
  const tests: TestItem[] = [];
  function record(id: string, name: string, condition: boolean, details?: string) {
    tests.push({ id, name, pass: condition, details });
    console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${id}: ${name}${details ? ` -> ${details}` : ''}`);
  }

  console.log('\n--- SUITE 9: Comprehensive Mandatory Attachments Universal Validation (Claims & Surveys) ---');

  const adminLogin = await requestApi('POST', '/api/auth/login', { email: 'admin@pilship.com', password: 'Password123!' });
  const adminToken = adminLogin.body.token;

  const agencyLogin = await requestApi('POST', '/api/auth/login', { email: 'agency@pilship.com', password: 'Password123!' });
  const agencyToken = agencyLogin.body.token;

  // Helpers to parse attachments from responses safely
  function parseAttachments(body: any): any[] {
    if (!body || !body.attachments) return [];
    if (Array.isArray(body.attachments)) return body.attachments;
    if (typeof body.attachments === 'string') {
      try {
        return JSON.parse(body.attachments);
      } catch {
        return [];
      }
    }
    return [];
  }

  // =========================================================================
  // SECTION 1: CLAIM MODULE COMPLETE SCENARIO MATRIX
  // =========================================================================

  // SCENARIO 1: 13 mandatory documents, all complete -> save accepted
  const all13CompleteAttachments = MANDATORY_DOCS_DRY_CLAIM.map((doc, idx) => ({
    type: doc,
    comment: `Valid reason for document #${idx + 1}: ${doc}`,
  }));

  const resClaim1 = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100001',
    claimant: 'Scenario 1 Claimant Ltd',
    claimant_type: 'Cargo Insurer',
    cargo_type: 'dry',
    nature_of_damage_type: 'Water Damage',
    date_of_incident: '2026-05-10',
    place_of_incident: 'Port Terminal',
    incident_description: 'Cargo water damage observed upon unsealing',
    attachments: all13CompleteAttachments,
  }, agencyToken);

  const claim1 = resClaim1.body;
  record(
    'ATT-CLAIM-SC1',
    'Claim S1: 13 mandatory dry documents, all complete -> save accepted (201)',
    resClaim1.status === 201 && typeof claim1.id === 'string'
  );

  // SCENARIO 2: 12 complete with files, 13th has a valid reason -> save accepted
  const claim12Files1Reason = MANDATORY_DOCS_DRY_CLAIM.map((doc, idx) => {
    if (idx === 12) {
      // 13th document: Marine insurance policy certificate has a valid reason
      return {
        type: doc,
        comment: 'Marine insurance policy certificate is kept at owner HQ and will follow',
      };
    }
    // First 12 documents have valid file uploads
    return {
      type: doc,
      file_url: `/api/files/test_stored_file_${idx}.pdf`,
      file_name: `doc_${idx}.pdf`,
      attachment_id: `att-id-${idx}`,
    };
  });

  const resClaim2 = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100001',
    claimant: 'Scenario 2 Claimant Ltd',
    claimant_type: 'Shipper',
    cargo_type: 'dry',
    nature_of_damage_type: 'Crushed/Contorted Cargo',
    date_of_incident: '2026-05-11',
    place_of_incident: 'Yard B',
    incident_description: 'Container crushed during stacking',
    attachments: claim12Files1Reason,
  }, agencyToken);

  const claim2 = resClaim2.body;
  record(
    'ATT-CLAIM-SC2',
    'Claim S2: 12 complete with files, 13th has a valid reason -> save accepted (201)',
    resClaim2.status === 201 && typeof claim2.id === 'string'
  );

  // SCENARIO 3: Erase the 13th reason, no file exists -> save rejected
  const claim2AttachmentsParsed = parseAttachments(claim2);
  const claim13thReasonErased = claim2AttachmentsParsed.map((a: any, idx: number) => {
    if (idx === 12) {
      return { type: a.type, comment: '' }; // reason erased, no file
    }
    return a;
  });

  const resClaim3 = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    attachments: claim13thReasonErased,
  }, agencyToken);

  record(
    'ATT-CLAIM-SC3',
    'Claim S3: Erase the 13th reason, no file exists -> save rejected (400)',
    resClaim3.status === 400 &&
    resClaim3.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS' &&
    resClaim3.body.missing_documents.some((d: string) => d.includes('Marine insurance policy certificate'))
  );

  // SCENARIO 4: Upload the 13th file -> save accepted
  const claim13thFileUploaded = claim2AttachmentsParsed.map((a: any, idx: number) => {
    if (idx === 12) {
      return {
        type: a.type,
        file_url: '/api/files/marine_policy_uploaded.pdf',
        file_name: 'marine_policy.pdf',
        attachment_id: 'att-marine-99',
        comment: '', // no reason needed when file exists
      };
    }
    return a;
  });

  const resClaim4 = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    attachments: claim13thFileUploaded,
  }, agencyToken);

  record(
    'ATT-CLAIM-SC4',
    'Claim S4: Upload the 13th file (no reason) -> save accepted (200)',
    resClaim4.status === 200 && typeof resClaim4.body.id === 'string'
  );

  // SCENARIO 5: Remove the 13th file and leave no reason -> save rejected
  const claim13thFileRemoved = claim13thFileUploaded.map((a: any, idx: number) => {
    if (idx === 12) {
      return { type: a.type, comment: '' }; // file removed, comment empty
    }
    return a;
  });

  const resClaim5 = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    attachments: claim13thFileRemoved,
  }, agencyToken);

  record(
    'ATT-CLAIM-SC5',
    'Claim S5: Remove the 13th file and leave no reason -> save rejected (400)',
    resClaim5.status === 400 &&
    resClaim5.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS'
  );

  // SCENARIO 6: Clear a reason containing only whitespace -> save rejected
  const claim13thWhitespace = claim13thFileUploaded.map((a: any, idx: number) => {
    if (idx === 12) {
      return { type: a.type, comment: '    \t   \n  ' }; // whitespace only
    }
    return a;
  });

  const resClaim6 = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    attachments: claim13thWhitespace,
  }, agencyToken);

  record(
    'ATT-CLAIM-SC6',
    'Claim S6: Clear a reason containing only whitespace -> save rejected (400)',
    resClaim6.status === 400 &&
    resClaim6.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS'
  );

  // SCENARIO 7: Change Dry to Reefer -> reevaluate Reefer checklist (missing reefer docs rejected)
  // Attempt to switch claim2 to 'reefer' without providing the 3 reefer mandatory attachments
  const resClaim7 = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    cargo_type: 'reefer',
    attachments: claim13thFileUploaded, // has only the 13 dry attachments
  }, agencyToken);

  record(
    'ATT-CLAIM-SC7',
    'Claim S7: Change Dry to Reefer with incomplete reefer docs -> save rejected (400)',
    resClaim7.status === 400 &&
    resClaim7.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS' &&
    resClaim7.body.missing_documents.some((d: string) => d.includes('Pre-shipment survey report'))
  );

  // SCENARIO 8: Change Reefer to Dry -> reevaluate Dry checklist (accepted when dry docs complete)
  // First, satisfy all 16 reefer documents and update to reefer
  const all16ReeferAttachments = MANDATORY_DOCS_REEFER_CLAIM.map((doc) => ({
    type: doc,
    comment: `Reefer approved comment for ${doc}`,
  }));

  const resClaim8Reefer = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    cargo_type: 'reefer',
    attachments: all16ReeferAttachments,
  }, agencyToken);

  // Now switch back from Reefer to Dry: Dry checklist (13 docs) is satisfied by the preserved attachments
  const resClaim8Dry = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    cargo_type: 'dry',
    attachments: all16ReeferAttachments, // contains all dry docs as well
  }, agencyToken);

  record(
    'ATT-CLAIM-SC8',
    'Claim S8: Change Reefer to Dry -> reevaluates Dry checklist and accepts (200)',
    resClaim8Reefer.status === 200 && resClaim8Dry.status === 200 && resClaim8Dry.body.cargo_type === 'dry'
  );

  // SCENARIO 9: Change Nature of Damage -> preserves attachments and accepts when valid
  const resClaim9 = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    nature_of_damage_type: 'Wet Cargo',
  }, agencyToken);

  record(
    'ATT-CLAIM-SC9',
    'Claim S9: Change Nature of Damage -> preserves attachments and accepts (200)',
    resClaim9.status === 200 && resClaim9.body.nature_of_damage_type === 'Wet Cargo'
  );

  // SCENARIO 10: Edit a previously created claim -> validation uses actual saved data
  const resClaim10Get = await requestApi('GET', `/api/claims/${claim2.id}`, null, agencyToken);
  const loadedAttachments = resClaim10Get.body.attachments;
  const resClaim10Save = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    attachments: loadedAttachments,
    claimant: 'Scenario 10 Claimant (Verified)',
  }, agencyToken);

  record(
    'ATT-CLAIM-SC10',
    'Claim S10: Edit previously created claim -> validation verifies actual saved attachments (200)',
    resClaim10Save.status === 200 && resClaim10Save.body.claimant === 'Scenario 10 Claimant (Verified)'
  );

  // SCENARIO 11: Partial update without attachment changes -> existing attachments remain preserved
  const resClaim11Partial = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    claims_handler: 'Alfred Tan',
  }, adminToken);

  const resClaim11Inspect = await requestApi('GET', `/api/claims/${claim2.id}`, null, agencyToken);
  const preservedCount = parseAttachments(resClaim11Inspect.body).length;

  record(
    'ATT-CLAIM-SC11',
    'Claim S11: Partial update without attachments -> existing attachments strictly preserved in DB',
    resClaim11Partial.status === 200 && preservedCount >= 13
  );

  // SCENARIO 12: Optional documents do not satisfy mandatory requirements
  const optionalOnly = [
    { type: 'Other Optional Attachment', file_url: '/api/files/optional.pdf' },
    { type: 'Customs Declaration', comment: 'Optional customs document' },
  ];

  const resClaim12Optional = await requestApi('POST', '/api/claims', {
    bl_number: 'PIL0100001',
    claimant: 'Optional Test Claimant',
    claimant_type: 'Shipper',
    cargo_type: 'dry',
    attachments: optionalOnly,
  }, agencyToken);

  record(
    'ATT-CLAIM-SC12',
    'Claim S12: Optional documents do not satisfy mandatory checklist requirements (400)',
    resClaim12Optional.status === 400 && resClaim12Optional.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS'
  );

  // =========================================================================
  // SECTION 2: SURVEY MODULE COMPLETE SCENARIO MATRIX
  // =========================================================================

  // SCENARIO 13: 5 mandatory dry survey documents, all complete -> save accepted
  const all5SurveyComplete = MANDATORY_DOCS_DRY_SURVEY.map((doc, idx) => ({
    type: doc,
    comment: `Survey verified checklist item #${idx + 1}: ${doc}`,
  }));

  const resSurvey1 = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100002',
    survey_reference_number: 'SRV-SC1-001',
    survey_requested_by: 'Marine Underwriter',
    date_of_survey: '2026-06-10',
    survey_cost: 1600.00,
    cargo_type: 'dry',
    nature_of_damage_type: 'Packaging Defect',
    incident_description: 'Joint survey conducted at terminal gate',
    attachments: all5SurveyComplete,
  }, agencyToken);

  const survey1 = resSurvey1.body;
  record(
    'ATT-SURVEY-SC1',
    'Survey S1: 5 mandatory dry survey documents, all complete -> save accepted (201)',
    resSurvey1.status === 201 && typeof survey1.id === 'string'
  );

  // SCENARIO 14: 4 complete with files, 5th has a valid reason -> save accepted
  const survey4Files1Reason = MANDATORY_DOCS_DRY_SURVEY.map((doc, idx) => {
    if (idx === 4) {
      // 5th document: Was the cargo unstuffed from the container -> reason provided
      return {
        type: doc,
        comment: 'Cargo remains stuffed in container pending customs clearance',
      };
    }
    return {
      type: doc,
      file_url: `/api/files/survey_file_${idx}.pdf`,
      file_name: `survey_doc_${idx}.pdf`,
      attachment_id: `att-svy-${idx}`,
    };
  });

  const resSurvey2 = await requestApi('POST', '/api/surveys', {
    bl_number: 'PIL0100002',
    survey_reference_number: 'SRV-SC2-002',
    survey_requested_by: 'Consignee Agent',
    date_of_survey: '2026-06-11',
    survey_cost: 1750.00,
    cargo_type: 'dry',
    nature_of_damage_type: 'Water Damage',
    incident_description: 'Survey at dest warehouse',
    attachments: survey4Files1Reason,
  }, agencyToken);

  const survey2 = resSurvey2.body;
  record(
    'ATT-SURVEY-SC2',
    'Survey S2: 4 complete with files, 5th has a valid reason -> save accepted (201)',
    resSurvey2.status === 201 && typeof survey2.id === 'string'
  );

  // SCENARIO 15: Erase 5th reason on survey, no file exists -> save rejected
  const survey2AttachmentsParsed = parseAttachments(survey2);
  const survey5thReasonErased = survey2AttachmentsParsed.map((a: any, idx: number) => {
    if (idx === 4) {
      return { type: a.type, comment: '' }; // reason erased, no file
    }
    return a;
  });

  const resSurvey3 = await requestApi('PUT', `/api/surveys/${survey2.id}`, {
    attachments: survey5thReasonErased,
  }, agencyToken);

  record(
    'ATT-SURVEY-SC3',
    'Survey S3: Erase the 5th reason, no file exists -> save rejected (400)',
    resSurvey3.status === 400 &&
    resSurvey3.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS' &&
    resSurvey3.body.missing_documents.some((d: string) => d.includes('Was the cargo unstuffed'))
  );

  // SCENARIO 16: Upload 5th file on survey -> save accepted
  const survey5thFileUploaded = survey2AttachmentsParsed.map((a: any, idx: number) => {
    if (idx === 4) {
      return {
        type: a.type,
        file_url: '/api/files/unstuffing_tally_sheet.pdf',
        file_name: 'unstuffing_tally_sheet.pdf',
        attachment_id: 'att-unstuff-101',
        comment: '',
      };
    }
    return a;
  });

  const resSurvey4 = await requestApi('PUT', `/api/surveys/${survey2.id}`, {
    attachments: survey5thFileUploaded,
  }, agencyToken);

  record(
    'ATT-SURVEY-SC4',
    'Survey S4: Upload the 5th file (no reason) -> save accepted (200)',
    resSurvey4.status === 200 && typeof resSurvey4.body.id === 'string'
  );

  // SCENARIO 17: Remove 5th file on survey and leave no reason -> save rejected
  const survey5thFileRemoved = survey5thFileUploaded.map((a: any, idx: number) => {
    if (idx === 4) {
      return { type: a.type, comment: '' };
    }
    return a;
  });

  const resSurvey5 = await requestApi('PUT', `/api/surveys/${survey2.id}`, {
    attachments: survey5thFileRemoved,
  }, agencyToken);

  record(
    'ATT-SURVEY-SC5',
    'Survey S5: Remove 5th file and leave no reason -> save rejected (400)',
    resSurvey5.status === 400 &&
    resSurvey5.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS'
  );

  // SCENARIO 18: Clear reason to whitespace on survey -> save rejected
  const survey5thWhitespace = survey5thFileUploaded.map((a: any, idx: number) => {
    if (idx === 4) {
      return { type: a.type, comment: '    \n\t  ' };
    }
    return a;
  });

  const resSurvey6 = await requestApi('PUT', `/api/surveys/${survey2.id}`, {
    attachments: survey5thWhitespace,
  }, agencyToken);

  record(
    'ATT-SURVEY-SC6',
    'Survey S6: Clear reason containing only whitespace on survey -> save rejected (400)',
    resSurvey6.status === 400 &&
    resSurvey6.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS'
  );

  // SCENARIO 19: Change Dry to Reefer on Survey -> reevaluate Reefer survey checklist
  // Attempt to switch to reefer without providing the 3 reefer survey attachments
  const resSurvey7 = await requestApi('PUT', `/api/surveys/${survey2.id}`, {
    cargo_type: 'reefer',
    attachments: survey5thFileUploaded, // has only the dry survey docs
  }, agencyToken);

  record(
    'ATT-SURVEY-SC7',
    'Survey S7: Change Dry to Reefer with incomplete reefer survey docs -> save rejected (400)',
    resSurvey7.status === 400 &&
    resSurvey7.body.code === 'INCOMPLETE_MANDATORY_ATTACHMENTS' &&
    resSurvey7.body.missing_documents.some((d: string) => d.includes('current temperature'))
  );

  // SCENARIO 20: Change Reefer to Dry on Survey -> reevaluate Dry survey checklist
  const all3ReeferSurvey = MANDATORY_DOCS_REEFER_SURVEY.map((doc) => ({
    type: doc,
    comment: `Reefer survey condition documented: ${doc}`,
  }));

  const resSurvey8Reefer = await requestApi('PUT', `/api/surveys/${survey2.id}`, {
    cargo_type: 'reefer',
    attachments: all3ReeferSurvey,
  }, agencyToken);

  // Now switch back to dry with complete dry attachments
  const resSurvey8Dry = await requestApi('PUT', `/api/surveys/${survey2.id}`, {
    cargo_type: 'dry',
    attachments: all5SurveyComplete,
  }, agencyToken);

  record(
    'ATT-SURVEY-SC8',
    'Survey S8: Change Reefer to Dry on survey -> reevaluates Dry checklist and accepts (200)',
    resSurvey8Reefer.status === 200 && resSurvey8Dry.status === 200 && resSurvey8Dry.body.cargo_type === 'dry'
  );

  // SCENARIO 21: Edit previously created survey -> validation uses actual saved data
  const resSurvey9Get = await requestApi('GET', `/api/surveys/${survey2.id}`, null, agencyToken);
  const loadedSurveyAttachments = resSurvey9Get.body.attachments;
  const resSurvey9Save = await requestApi('PUT', `/api/surveys/${survey2.id}`, {
    attachments: loadedSurveyAttachments,
    request_coordinator: 'Survey Coordinator Alpha',
  }, agencyToken);

  record(
    'ATT-SURVEY-SC9',
    'Survey S9: Edit previously created survey -> validation verifies actual saved attachments (200)',
    resSurvey9Save.status === 200 && resSurvey9Save.body.request_coordinator === 'Survey Coordinator Alpha'
  );

  // SCENARIO 22: Partial update on survey without attachments -> existing attachments preserved
  const resSurvey10Partial = await requestApi('PUT', `/api/surveys/${survey2.id}`, {
    survey_status: 'appointed',
    cms_reference_number: 'CMS-SVY-PARTIAL-888',
  }, adminToken);

  const resSurvey10Inspect = await requestApi('GET', `/api/surveys/${survey2.id}`, null, agencyToken);
  const preservedSurveyCount = parseAttachments(resSurvey10Inspect.body).length;

  record(
    'ATT-SURVEY-SC10',
    'Survey S10: Partial update without attachments -> existing attachments strictly preserved in DB',
    resSurvey10Partial.status === 200 && preservedSurveyCount >= 5
  );

  // SCENARIO 23: Document title matching resilience
  const matchPunctuation = isDocMatching(
    'Marine insurance policy certificate (As applicable)',
    'marine insurance policy certificate'
  );
  const matchExact = isDocMatching('Commercial Invoice', 'Commercial Invoice');
  const nonMatch = isDocMatching('Commercial Invoice', 'Packing List');
  const optionalNoMatch = isDocMatching('Other Supporting Docs', 'Commercial Invoice');

  record(
    'ATT-UNIT-1',
    'Unit 1: Document title matching: Punctuation/suffix resilient without cross-document false positives',
    matchPunctuation && matchExact && !nonMatch && !optionalNoMatch
  );

  // SCENARIO 24: Upload validation requires stored reference (file_url or attachment_id), NOT merely filename
  const fakeUpload = hasValidUpload({ file_name: 'fake_document.pdf' });
  const realUrlUpload = hasValidUpload({ file_url: '/api/files/stored_doc_1.pdf' });
  const realIdUpload = hasValidUpload({ attachment_id: 'att-123456789' });

  record(
    'ATT-UNIT-2',
    'Unit 2: Upload verification: Filename alone without file_url/attachment_id rejected as un-uploaded',
    !fakeUpload && realUrlUpload && realIdUpload
  );

  // =========================================================================
  // SECTION 3: MANDATORY FORM-FIELD ERASURE & WHITESPACE VALIDATION
  // =========================================================================

  // SCENARIO 25: Erase mandatory claimant field on claim edit -> rejected (400)
  const resEraseClaimant = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    claimant: '   ', // whitespace only
  }, agencyToken);

  record(
    'ATT-FIELD-1',
    'Form Field: Erasing claimant or setting to whitespace on claim edit is rejected (400)',
    resEraseClaimant.status === 400 && resEraseClaimant.body.error.includes('Claimant')
  );

  // SCENARIO 26: Erase mandatory BL number on claim edit -> rejected (400)
  const resEraseBl = await requestApi('PUT', `/api/claims/${claim2.id}`, {
    bl_number: '', // empty string
  }, agencyToken);

  record(
    'ATT-FIELD-2',
    'Form Field: Erasing BL number on claim edit is rejected (400)',
    resEraseBl.status === 400 && resEraseBl.body.error.includes('BL number')
  );

  // SCENARIO 27: Erase mandatory survey reference number on survey edit -> rejected (400)
  const resEraseSurveyRef = await requestApi('PUT', `/api/surveys/${survey2.id}`, {
    survey_reference_number: '   ', // whitespace only
  }, agencyToken);

  record(
    'ATT-FIELD-3',
    'Form Field: Erasing survey reference number or setting to whitespace on survey edit is rejected (400)',
    resEraseSurveyRef.status === 400 && resEraseSurveyRef.body.error.includes('Survey reference number')
  );

  // SCENARIO 28: Erase survey cost on survey edit -> rejected (400)
  const resEraseSurveyCost = await requestApi('PUT', `/api/surveys/${survey2.id}`, {
    survey_cost: '', // empty cost
  }, agencyToken);

  record(
    'ATT-FIELD-4',
    'Form Field: Erasing survey cost on survey edit is rejected (400)',
    resEraseSurveyCost.status === 400 && resEraseSurveyCost.body.error.includes('cost')
  );

  // SCENARIO 29: Sequential state transitions: fill reason -> erase -> whitespace -> upload -> remove
  const testDoc = 'Bill of Lading (front & reverse page)';
  // 1. Fill reason
  const stateWithReason = [{ type: testDoc, comment: 'Initial valid reason' }];
  const val1 = validateClaimMandatoryAttachments(stateWithReason, 'dry');
  // 2. Erase reason
  const stateErased = [{ type: testDoc, comment: '' }];
  const val2 = validateClaimMandatoryAttachments(stateErased, 'dry');
  // 3. Type whitespace
  const stateWhitespace = [{ type: testDoc, comment: '    \t   ' }];
  const val3 = validateClaimMandatoryAttachments(stateWhitespace, 'dry');
  // 4. Upload file
  const stateUploaded = [{ type: testDoc, file_url: '/api/files/bl_scan.pdf', comment: '' }];
  const val4 = validateClaimMandatoryAttachments(stateUploaded, 'dry');
  // 5. Remove file without reason
  const stateRemoved = [{ type: testDoc, comment: '' }];
  const val5 = validateClaimMandatoryAttachments(stateRemoved, 'dry');

  record(
    'ATT-SYNC-1',
    'State Transitions: fill reason -> erase -> whitespace -> upload -> remove strictly tracked without stale cache',
    !val1.missing.includes(testDoc) &&
    val2.missing.includes(testDoc) &&
    val3.missing.includes(testDoc) &&
    !val4.missing.includes(testDoc) &&
    val5.missing.includes(testDoc)
  );

  return tests;
}
