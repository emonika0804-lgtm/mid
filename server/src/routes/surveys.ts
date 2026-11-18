import { Router, Response } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest, authenticate, requireRole } from '../auth';
import db from '../db';
import { pool } from '../pgdb';
import { syncSurveyAttachments, syncClaimAttachments } from '../attachmentService';
import { CLAIM_ADVISORY_LOCK_ID, generateClaimNumber } from './claims';
import {
  MANDATORY_DOCS_DRY_SURVEY,
  MANDATORY_DOCS_REEFER_SURVEY,
  validateSurveyMandatoryAttachments,
  MANDATORY_DOCS_DRY_CLAIM,
  MANDATORY_DOCS_REEFER_CLAIM,
  validateClaimMandatoryAttachments,
  isDocMatching,
  hasValidUpload,
  hasValidReason,
} from '../attachmentValidation';
import {
  validateMonetaryAmount,
  recalculateAndSanitizeTallyRecords,
} from '../financialService';

export const SUPPORTED_SURVEY_STATUSES = [
  'new_survey',
  'appointed',
  'pending',
  'rejected',
  'accepted',
] as const;

export type SupportedSurveyStatus = typeof SUPPORTED_SURVEY_STATUSES[number];

export function isValidSurveyStatus(status: any): status is SupportedSurveyStatus {
  return typeof status === 'string' && (SUPPORTED_SURVEY_STATUSES as readonly string[]).includes(status);
}

export const SURVEY_ADVISORY_LOCK_ID = 20260426;

export {
  MANDATORY_DOCS_DRY_SURVEY,
  MANDATORY_DOCS_REEFER_SURVEY,
  validateSurveyMandatoryAttachments,
};

const router = Router();

export async function generateSurveyNumber(existingClient?: any): Promise<string> {
  const client = existingClient || (await pool.connect());
  const shouldRelease = !existingClient;
  try {
    const year = new Date().getFullYear();
    const prefix = `SVY-${year}-`;
    const res = await client.query(
      `SELECT survey_number FROM surveys WHERE survey_number LIKE $1`,
      [`${prefix}%`]
    );
    let maxSeq = 0;
    for (const row of res.rows) {
      const seq = parseInt(row.survey_number.replace(prefix, ''), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
    return `${prefix}${(maxSeq + 1).toString().padStart(4, '0')}`;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

function parseJSONSafely(str: any, fallback: any = []) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// Sync survey status to all linked claims (Rule 15)
async function syncSurveyStatusToClaims(survey: any, newStatus: string) {
  let mappedStatus = 'none';
  if (newStatus === 'rejected') {
    mappedStatus = 'rejected';
  } else if (newStatus === 'appointed' || newStatus === 'accepted') {
    mappedStatus = 'appointed';
  }

  const claimIdsToUpdate = new Set<string>();
  if (survey.claim_id) claimIdsToUpdate.add(survey.claim_id);
  if (survey.originating_claim_id) claimIdsToUpdate.add(survey.originating_claim_id);

  for (const cId of claimIdsToUpdate) {
    await db.prepare(`
      UPDATE claims SET survey_status = ?, survey_case_number = ?, last_action_date = ?
      WHERE id = ?
    `).run(mappedStatus, survey.survey_number, new Date().toISOString(), cId);
  }
}

// 1. Convert to Claim (Section 6.3 & Rule 14)
// Only when survey_status=appointed or accepted AND user is MID
router.post('/:id/convert-to-claim', authenticate, requireRole(['mid', 'mid_gcc', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Acquire existing claim advisory transaction lock using the transaction client
    await client.query('SELECT pg_advisory_xact_lock($1)', [CLAIM_ADVISORY_LOCK_ID]);

    // Lock the survey row using SELECT ... FOR UPDATE
    const surveyRes = await client.query('SELECT * FROM surveys WHERE id = $1 FOR UPDATE', [id]);
    if (surveyRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Survey not found' });
    }

    const survey = surveyRes.rows[0];

    if (survey.survey_status !== 'appointed' && survey.survey_status !== 'accepted') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Survey must be appointed or accepted before converting to claim' });
    }

    // Check converted_to_claim_id again after obtaining row lock to prevent duplicate conversion
    if (survey.converted_to_claim_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Survey has already been converted to claim ${survey.converted_to_claim_number}`,
        claim_id: survey.converted_to_claim_id,
        claim_number: survey.converted_to_claim_number,
        already_converted: true,
      });
    }

    // Reconcile and map survey attachments to claim mandatory document requirements (Finding 6)
    const rawSurveyAttachments = parseJSONSafely(survey.attachments, []);
    const effectiveCargoType = survey.cargo_type || 'dry';
    const isReefer = effectiveCargoType.toLowerCase() === 'reefer';
    const targetClaimDocs = isReefer ? MANDATORY_DOCS_REEFER_CLAIM : MANDATORY_DOCS_DRY_CLAIM;

    const mappedClaimAttachments: any[] = [];
    const usedSurveyAttachments = new Set<any>();

    for (const doc of targetClaimDocs) {
      // Find matching item from survey attachments with genuine stored file
      const matchingWithUpload = rawSurveyAttachments.find((att: any) =>
        !usedSurveyAttachments.has(att) &&
        isDocMatching(att.type || att.mandatory_attachment_type, doc) &&
        hasValidUpload(att)
      );

      if (matchingWithUpload) {
        usedSurveyAttachments.add(matchingWithUpload);
        mappedClaimAttachments.push({
          ...matchingWithUpload,
          type: doc,
          mandatory_attachment_type: doc,
        });
        continue;
      }

      // Check if matching item exists with a valid reason
      const matchingWithReason = rawSurveyAttachments.find((att: any) =>
        !usedSurveyAttachments.has(att) &&
        isDocMatching(att.type || att.mandatory_attachment_type, doc) &&
        hasValidReason(att)
      );

      if (matchingWithReason) {
        usedSurveyAttachments.add(matchingWithReason);
        mappedClaimAttachments.push({
          ...matchingWithReason,
          type: doc,
          mandatory_attachment_type: doc,
        });
        continue;
      }

      // Claim-required document not provided in survey: initialize meaningful missing-document reason
      mappedClaimAttachments.push({
        type: doc,
        mandatory_attachment_type: doc,
        comment: 'Not provided during survey conversion; pending claim-stage submission.',
      });
    }

    // Preserve any remaining non-matching survey attachments
    for (const att of rawSurveyAttachments) {
      if (!usedSurveyAttachments.has(att)) {
        mappedClaimAttachments.push(att);
      }
    }

    // Generate concurrency-safe sequential claim number using shared generator on same client
    const claimNumber = await generateClaimNumber(client);
    const claimId = `clm-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    // Time bar = 1 year from discharge_date (or 1 year from now)
    let calculatedTimeBar: string;
    if (survey.discharge_date) {
      const d = new Date(survey.discharge_date);
      d.setFullYear(d.getFullYear() + 1);
      calculatedTimeBar = d.toISOString();
    } else {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      calculatedTimeBar = d.toISOString();
    }

    // Insert claim in same transaction
    await client.query(
      `INSERT INTO claims (
        id, claim_number, cms_number, bl_number, shipper, consignee, notify_party,
        place_of_receipt, port_of_loading, port_of_discharge, place_of_delivery,
        vessel_code, vessel_name, vessel_voyage, commodity, container_number,
        container_size, seal_number, weight, quantity, package_type, discharge_date,
        port_of_landing_date, port_of_discharge_date, country, claim_amount,
        claimant, claimant_type, status, awaiting_input_reason, closed_reason,
        claims_handler, time_bar_date, last_action_date, acknowledged_date,
        sla_status, survey_status, survey_case_number, incident_description,
        date_of_incident, place_of_incident, cargo_type, nature_of_damage_category,
        nature_of_damage_type, nature_of_damage_dry, nature_of_damage_reefer,
        selected_containers, containers_with_sizes, policy_deductible_type,
        policy_pi_club, policy_number, policy_deductible_usd,
        affiliated_claim_number, reference_number, expense_tally_records,
        recovery_tally_records, email_thread, mail_thread_attachments,
        claim_amount_history, originating_survey_id, originating_survey_number,
        response_received_history, comments, attachments, created_by_id,
        created_by_name, created_date, updated_date
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22,
        $23, $24, $25, $26,
        $27, $28, $29, $30, $31,
        $32, $33, $34, $35,
        $36, $37, $38, $39,
        $40, $41, $42, $43,
        $44, $45, $46,
        $47, $48, $49,
        $50, $51, $52,
        $53, $54, $55,
        $56, $57, $58,
        $59, $60, $61,
        $62, $63, $64, $65,
        $66, $67, $68
      )`,
      [
        claimId,
        claimNumber,
        survey.cms_reference_number,
        survey.bl_number,
        survey.shipper,
        survey.consignee,
        survey.notify_party,
        survey.place_of_receipt,
        survey.port_of_loading,
        survey.port_of_discharge,
        survey.place_of_delivery,
        survey.vessel_code,
        survey.vessel_name,
        survey.vessel_voyage,
        survey.commodity,
        survey.container_number,
        survey.container_size,
        survey.seal_number,
        survey.weight,
        survey.quantity,
        survey.package_type,
        survey.discharge_date,
        survey.port_of_landing_date,
        survey.port_of_discharge_date,
        survey.country,
        survey.survey_cost, // initial claim amount as survey cost
        survey.survey_requested_by, // claimant
        'Booking Party', // default claimant type
        'new_claim',
        '', // awaiting_input_reason
        '', // closed_reason
        null, // claims_handler
        calculatedTimeBar,
        now,
        now,
        'green',
        'appointed',
        survey.survey_number,
        survey.incident_description,
        survey.date_of_incident,
        survey.place_of_incident,
        survey.cargo_type || 'dry',
        survey.nature_of_damage_category,
        survey.nature_of_damage_type,
        survey.nature_of_damage_dry,
        survey.nature_of_damage_reefer,
        survey.selected_containers || '[]',
        survey.containers_with_sizes || '[]',
        null, // policy_deductible_type
        null, // policy_pi_club
        null, // policy_number
        null, // policy_deductible_usd
        null, // affiliated_claim_number
        null, // reference_number
        survey.expense_tally_records || '[]',
        survey.recovery_tally_records || '[]',
        '[]', // email_thread
        '[]', // mail_thread_attachments
        '[]', // claim_amount_history
        survey.id,
        survey.survey_number,
        '[]', // response_received_history
        survey.comments || '[]',
        JSON.stringify(mappedClaimAttachments),
        user.id,
        user.full_name,
        now,
        now
      ]
    );

    // Update survey with converted links in same transaction
    await client.query(
      `UPDATE surveys SET converted_to_claim_id = $1, converted_to_claim_number = $2, updated_date = $3 WHERE id = $4`,
      [claimId, claimNumber, now, id]
    );

    // Dual audit logs in same transaction
    await client.query(
      `INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, details, created_date)
       VALUES ($1, 'Survey', $2, $3, 'CONVERT', $4, $5, $6, $7)`,
      [`aud-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`, id, survey.survey_number, user.id, user.full_name, `Survey ${survey.survey_number} converted to Claim ${claimNumber}`, now]
    );

    await client.query(
      `INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, details, created_date)
       VALUES ($1, 'Claim', $2, $3, 'CREATE', $4, $5, $6, $7)`,
      [`aud-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`, claimId, claimNumber, user.id, user.full_name, `Claim created from Survey ${survey.survey_number}`, now]
    );

    await client.query('COMMIT');

    // Sync attachments metadata for newly created claim
    try {
      await syncClaimAttachments(claimId, claimNumber, survey.bl_number, survey.cms_reference_number, mappedClaimAttachments, user.id, user.full_name);
    } catch (err) {
      console.warn('Note: syncClaimAttachments error on conversion:', err);
    }

    return res.json({
      message: 'Survey successfully converted to claim',
      claim_id: claimId,
      claim_number: claimNumber,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Survey-to-claim conversion error:', err);
    return res.status(500).json({ error: 'Failed to convert survey to claim.' });
  } finally {
    client.release();
  }
});

// 2. List surveys
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { search, status } = req.query;

  let query = 'SELECT * FROM surveys WHERE 1=1';
  const params: any[] = [];

  // RLS: agency users only see own surveys
  if (user.role === 'agency') {
    query += ' AND created_by_id = ?';
    params.push(user.id);
  }

  if (status && typeof status === 'string' && status !== 'all') {
    query += ' AND survey_status = ?';
    params.push(status);
  }

  if (search && typeof search === 'string') {
    const s = `%${search.trim().toLowerCase()}%`;
    query += ' AND (LOWER(survey_number) LIKE ? OR LOWER(bl_number) LIKE ? OR LOWER(survey_requested_by) LIKE ?)';
    params.push(s, s, s);
  }

  query += ' ORDER BY created_date DESC';

  const rows = (await db.prepare(query).all(...params)) as any[];

  const parsed = rows.map(r => ({
    ...r,
    selected_containers: parseJSONSafely(r.selected_containers, []),
    containers_with_sizes: parseJSONSafely(r.containers_with_sizes, []),
    expense_tally_records: parseJSONSafely(r.expense_tally_records, []),
    recovery_tally_records: parseJSONSafely(r.recovery_tally_records, []),
    mail_thread_attachments: parseJSONSafely(r.mail_thread_attachments, []),
    comments: parseJSONSafely(r.comments, []),
    attachments: parseJSONSafely(r.attachments, []),
  }));

  return res.json(parsed);
});

// 3. Get single survey
router.get('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { id } = req.params;

  const r = (await db.prepare('SELECT * FROM surveys WHERE id = ?').get(id)) as any;
  if (!r) {
    return res.status(404).json({ error: 'Survey not found' });
  }

  if (user.role === 'agency' && r.created_by_id !== user.id) {
    return res.status(403).json({ error: 'Access denied: You do not have permission to view this survey' });
  }

  return res.json({
    ...r,
    selected_containers: parseJSONSafely(r.selected_containers, []),
    containers_with_sizes: parseJSONSafely(r.containers_with_sizes, []),
    expense_tally_records: parseJSONSafely(r.expense_tally_records, []),
    recovery_tally_records: parseJSONSafely(r.recovery_tally_records, []),
    mail_thread_attachments: parseJSONSafely(r.mail_thread_attachments, []),
    comments: parseJSONSafely(r.comments, []),
    attachments: parseJSONSafely(r.attachments, []),
  });
});

// 4. Create survey
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const body = req.body;

  if (!body.bl_number || (typeof body.bl_number === 'string' && !body.bl_number.trim())) {
    return res.status(400).json({ error: 'BL number is required' });
  }
  if (!body.survey_reference_number || (typeof body.survey_reference_number === 'string' && !body.survey_reference_number.trim())) {
    return res.status(400).json({ error: 'Survey Reference Number is required' });
  }
  if (!body.survey_requested_by || (typeof body.survey_requested_by === 'string' && !body.survey_requested_by.trim())) {
    return res.status(400).json({ error: 'Survey Requested By is required' });
  }
  if (!body.date_of_survey || (typeof body.date_of_survey === 'string' && !body.date_of_survey.trim())) {
    return res.status(400).json({ error: 'Date of Survey is required' });
  }
  const surveyCostVal = validateMonetaryAmount(body.survey_cost, 'Survey cost', false);
  if (!surveyCostVal.valid) {
    return res.status(400).json({ error: surveyCostVal.error, code: surveyCostVal.code });
  }

  const expenseTallyResult = await recalculateAndSanitizeTallyRecords(body.expense_tally_records, false);
  if (!expenseTallyResult.valid) {
    return res.status(400).json({ error: expenseTallyResult.error, code: expenseTallyResult.code });
  }

  const recoveryTallyResult = await recalculateAndSanitizeTallyRecords(body.recovery_tally_records, true);
  if (!recoveryTallyResult.valid) {
    return res.status(400).json({ error: recoveryTallyResult.error, code: recoveryTallyResult.code });
  }

  const isMid = ['mid', 'mid_gcc', 'admin'].includes(user.role);
  if (isMid && (!body.cms_reference_number || (typeof body.cms_reference_number === 'string' && !body.cms_reference_number.trim()))) {
    return res.status(400).json({ error: 'CMS Reference Number is required for MID submission' });
  }

  // 1. Mandatory survey attachment validation on EVERY survey creation (unconditional enforcement)
  const rawAttachments = body.attachments !== undefined
    ? (Array.isArray(body.attachments)
        ? body.attachments
        : typeof body.attachments === 'string'
        ? parseJSONSafely(body.attachments, [])
        : [])
    : [];

  const effectiveCargoType = body.cargo_type || 'dry';
  const validation = validateSurveyMandatoryAttachments(rawAttachments, effectiveCargoType);
  if (!validation.valid) {
    return res.status(400).json({
      error: `Mandatory attachment validation failed: The following document(s) require either an uploaded file or a missing-document reason: ${validation.missing.join(', ')}`,
      code: 'INCOMPLETE_MANDATORY_ATTACHMENTS',
      missing_documents: validation.missing,
    });
  }

  // 2. Validate survey status if provided; agency is strictly locked to 'new_survey'
  let initialStatus = 'new_survey';
  if (body.survey_status !== undefined) {
    if (typeof body.survey_status !== 'string' || !isValidSurveyStatus(body.survey_status)) {
      return res.status(400).json({
        error: `Invalid survey status: ${body.survey_status}. Supported statuses are: ${SUPPORTED_SURVEY_STATUSES.join(', ')}`,
      });
    }
    if (isMid) {
      initialStatus = body.survey_status;
    }
  }

  const now = new Date().toISOString();

  // 3. Concurrency-safe atomic survey creation with advisory transaction lock & retry logic
  let createdSurvey: any = null;
  const maxRetries = 5;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Concurrency lock for survey number generation
      await client.query('SELECT pg_advisory_xact_lock($1)', [SURVEY_ADVISORY_LOCK_ID]);

      const surveyNumber = await generateSurveyNumber(client);
      const surveyId = `svy-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      const newSurvey = {
        id: surveyId,
        survey_number: surveyNumber,
        survey_created_date: now,
        survey_requested_by: body.survey_requested_by,
        survey_status: initialStatus,
        survey_reference_number: body.survey_reference_number,
        cms_reference_number: isMid ? (body.cms_reference_number || null) : null,
        date_of_survey: body.date_of_survey,
        request_coordinator: body.request_coordinator || null,
        survey_cost: surveyCostVal.value!,
        bl_number: (body.bl_number || '').trim().toUpperCase(),
        shipper: body.shipper || null,
        consignee: body.consignee || null,
        notify_party: body.notify_party || null,
        place_of_receipt: body.place_of_receipt || null,
        port_of_loading: body.port_of_loading || null,
        port_of_discharge: body.port_of_discharge || null,
        place_of_delivery: body.place_of_delivery || null,
        vessel_code: body.vessel_code || null,
        vessel_name: body.vessel_name || null,
        vessel_voyage: body.vessel_voyage || null,
        commodity: body.commodity || null,
        container_number: body.container_number || null,
        container_size: body.container_size || null,
        seal_number: body.seal_number || null,
        weight: body.weight ? Number(body.weight) : null,
        quantity: body.quantity ? Number(body.quantity) : null,
        package_type: body.package_type || null,
        discharge_date: body.discharge_date || null,
        port_of_landing_date: body.port_of_landing_date || null,
        port_of_discharge_date: body.port_of_discharge_date || null,
        country: body.country || null,
        incident_description: body.incident_description || null,
        date_of_incident: body.date_of_incident || null,
        place_of_incident: body.place_of_incident || null,
        cargo_type: body.cargo_type || 'dry',
        nature_of_damage_category: body.nature_of_damage_category || null,
        nature_of_damage_type: body.nature_of_damage_type || null,
        nature_of_damage_dry: body.nature_of_damage_dry || null,
        nature_of_damage_reefer: body.nature_of_damage_reefer || null,
        selected_containers: JSON.stringify(body.selected_containers || []),
        containers_with_sizes: JSON.stringify(body.containers_with_sizes || []),
        claim_id: body.claim_id || null,
        originating_claim_id: body.originating_claim_id || null,
        originating_claim_number: body.originating_claim_number || null,
        converted_to_claim_id: null,
        converted_to_claim_number: null,
        mail_thread_attachments: JSON.stringify(body.mail_thread_attachments || []),
        comments: JSON.stringify(body.comments || []),
        attachments: JSON.stringify(rawAttachments),
        expense_tally_records: JSON.stringify(expenseTallyResult.records || []),
        recovery_tally_records: JSON.stringify(recoveryTallyResult.records || []),
        created_by_id: user.id,
        created_by_name: user.full_name,
        created_date: now,
        updated_date: now,
      };

      await client.query(`
        INSERT INTO surveys (
          id, survey_number, survey_created_date, survey_requested_by, survey_status,
          survey_reference_number, cms_reference_number, date_of_survey, request_coordinator,
          survey_cost, bl_number, shipper, consignee, notify_party, place_of_receipt,
          port_of_loading, port_of_discharge, place_of_delivery, vessel_code, vessel_name,
          vessel_voyage, commodity, container_number, container_size, seal_number,
          weight, quantity, package_type, discharge_date, port_of_landing_date,
          port_of_discharge_date, country, incident_description, date_of_incident,
          place_of_incident, cargo_type, nature_of_damage_category, nature_of_damage_type,
          nature_of_damage_dry, nature_of_damage_reefer, selected_containers,
          containers_with_sizes, claim_id, originating_claim_id, originating_claim_number,
          converted_to_claim_id, converted_to_claim_number, mail_thread_attachments,
          comments, attachments, expense_tally_records, recovery_tally_records,
          created_by_id, created_by_name, created_date, updated_date
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
          $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
          $51, $52, $53, $54, $55, $56
        )
      `, [
        newSurvey.id, newSurvey.survey_number, newSurvey.survey_created_date, newSurvey.survey_requested_by, newSurvey.survey_status,
        newSurvey.survey_reference_number, newSurvey.cms_reference_number, newSurvey.date_of_survey, newSurvey.request_coordinator,
        newSurvey.survey_cost, newSurvey.bl_number, newSurvey.shipper, newSurvey.consignee, newSurvey.notify_party, newSurvey.place_of_receipt,
        newSurvey.port_of_loading, newSurvey.port_of_discharge, newSurvey.place_of_delivery, newSurvey.vessel_code, newSurvey.vessel_name,
        newSurvey.vessel_voyage, newSurvey.commodity, newSurvey.container_number, newSurvey.container_size, newSurvey.seal_number,
        newSurvey.weight, newSurvey.quantity, newSurvey.package_type, newSurvey.discharge_date, newSurvey.port_of_landing_date,
        newSurvey.port_of_discharge_date, newSurvey.country, newSurvey.incident_description, newSurvey.date_of_incident,
        newSurvey.place_of_incident, newSurvey.cargo_type, newSurvey.nature_of_damage_category, newSurvey.nature_of_damage_type,
        newSurvey.nature_of_damage_dry, newSurvey.nature_of_damage_reefer, newSurvey.selected_containers,
        newSurvey.containers_with_sizes, newSurvey.claim_id, newSurvey.originating_claim_id, newSurvey.originating_claim_number,
        newSurvey.converted_to_claim_id, newSurvey.converted_to_claim_number, newSurvey.mail_thread_attachments,
        newSurvey.comments, newSurvey.attachments, newSurvey.expense_tally_records, newSurvey.recovery_tally_records,
        newSurvey.created_by_id, newSurvey.created_by_name, newSurvey.created_date, newSurvey.updated_date
      ]);

      if (body.originating_claim_id || body.claim_id) {
        const claimTargetId = body.originating_claim_id || body.claim_id;
        await client.query(
          `UPDATE claims SET survey_status = 'appointed', survey_case_number = $1, last_action_date = $2 WHERE id = $3`,
          [surveyNumber, now, claimTargetId]
        );
      }

      await client.query(
        `INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, details, created_date)
         VALUES ($1, 'Survey', $2, $3, 'CREATE', $4, $5, $6, $7)`,
        [`aud-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`, surveyId, surveyNumber, user.id, user.full_name, `Survey request ${surveyNumber} created for BL ${newSurvey.bl_number}`, now]
      );

      await client.query('COMMIT');
      createdSurvey = newSurvey;
      break;
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505' && attempt < maxRetries) {
        continue;
      }
      console.error('Survey creation database error:', err);
      return res.status(500).json({ error: 'Failed to create survey record.' });
    } finally {
      client.release();
    }
  }

  if (!createdSurvey) {
    return res.status(500).json({ error: 'Failed to generate unique survey number after multiple attempts.' });
  }

  // Sync attachment metadata for the new survey
  try {
    const parsedAttachments = parseJSONSafely(createdSurvey.attachments, []);
    await syncSurveyAttachments(createdSurvey.id, createdSurvey.survey_number, createdSurvey.bl_number, createdSurvey.cms_reference_number, parsedAttachments, user.id, user.full_name);
  } catch (err) {
    console.warn('Note: syncSurveyAttachments error on survey creation:', err);
  }

  return res.status(201).json(createdSurvey);
});

// 5. Update survey
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { id } = req.params;
  const body = req.body;

  const existing = (await db.prepare('SELECT * FROM surveys WHERE id = ?').get(id)) as any;
  if (!existing) {
    return res.status(404).json({ error: 'Survey not found' });
  }

  const isMid = ['mid', 'mid_gcc', 'admin'].includes(user.role);
  const isOwner = existing.created_by_id === user.id;

  if (!isMid && !isOwner) {
    return res.status(403).json({ error: 'Access denied: You cannot edit this survey' });
  }

  // 1. Status whitelist validation
  if (body.survey_status !== undefined) {
    if (typeof body.survey_status !== 'string' || !isValidSurveyStatus(body.survey_status)) {
      return res.status(400).json({
        error: `Invalid survey status: ${body.survey_status}. Supported statuses are: ${SUPPORTED_SURVEY_STATUSES.join(', ')}`,
      });
    }
  }

  // Reject clearing or whitespace on mandatory survey fields
  if (body.bl_number !== undefined && (typeof body.bl_number !== 'string' || !body.bl_number.trim())) {
    return res.status(400).json({ error: 'BL number cannot be empty' });
  }
  if (body.survey_reference_number !== undefined && (typeof body.survey_reference_number !== 'string' || !body.survey_reference_number.trim())) {
    return res.status(400).json({ error: 'Survey reference number cannot be empty' });
  }
  if (body.survey_requested_by !== undefined && (typeof body.survey_requested_by !== 'string' || !body.survey_requested_by.trim())) {
    return res.status(400).json({ error: 'Survey requested by cannot be empty' });
  }
  if (body.date_of_survey !== undefined && (typeof body.date_of_survey !== 'string' || !body.date_of_survey.trim())) {
    return res.status(400).json({ error: 'Date of survey cannot be empty' });
  }
  if (body.survey_cost !== undefined) {
    const surveyCostVal = validateMonetaryAmount(body.survey_cost, 'Survey cost', false);
    if (!surveyCostVal.valid) {
      return res.status(400).json({ error: surveyCostVal.error, code: surveyCostVal.code });
    }
  }

  // Validate mandatory attachments if attachments are being updated or cargo type changed
  const cargoTypeChanged = body.cargo_type !== undefined && body.cargo_type !== existing.cargo_type;
  if (body.attachments !== undefined || cargoTypeChanged) {
    const rawAttachments = body.attachments !== undefined
      ? (Array.isArray(body.attachments)
          ? body.attachments
          : typeof body.attachments === 'string'
          ? parseJSONSafely(body.attachments, [])
          : [])
      : parseJSONSafely(existing.attachments, []);

    const effectiveCargoType = body.cargo_type || existing.cargo_type || 'dry';
    const validation = validateSurveyMandatoryAttachments(rawAttachments, effectiveCargoType);

    if (!validation.valid) {
      return res.status(400).json({
        error: `Mandatory attachment validation failed: The following document(s) require either an uploaded file or a missing-document reason: ${validation.missing.join(', ')}`,
        code: 'INCOMPLETE_MANDATORY_ATTACHMENTS',
        missing_documents: validation.missing,
      });
    }
  }

  const now = new Date().toISOString();

  // Audit changes collection
  const auditEntries: Array<{ field: string; oldVal: string; newVal: string }> = [];

  function checkAuditChange(field: string, oldValRaw: any, newValRaw: any) {
    const oldVal = oldValRaw !== null && oldValRaw !== undefined ? String(oldValRaw) : '';
    const newVal = newValRaw !== null && newValRaw !== undefined ? String(newValRaw) : '';
    if (oldVal !== newVal) {
      auditEntries.push({ field, oldVal, newVal });
    }
  }

  function stringifyIfObject(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }

  // Status can only be changed by MID (Rule: agency cannot update survey status)
  let finalStatus = existing.survey_status;
  if (isMid && body.survey_status !== undefined) {
    if (body.survey_status !== existing.survey_status) {
      auditEntries.push({ field: 'survey_status', oldVal: existing.survey_status, newVal: body.survey_status });
      finalStatus = body.survey_status;
    }
  }

  // CMS number (MID only)
  let finalCms = existing.cms_reference_number;
  if (isMid && body.cms_reference_number !== undefined) {
    if (body.cms_reference_number !== existing.cms_reference_number) {
      auditEntries.push({ field: 'cms_reference_number', oldVal: existing.cms_reference_number || '', newVal: body.cms_reference_number });
      finalCms = body.cms_reference_number;
    }
  }

  const surveyRef = body.survey_reference_number !== undefined ? body.survey_reference_number : existing.survey_reference_number;
  const reqParty = body.survey_requested_by !== undefined ? body.survey_requested_by : existing.survey_requested_by;
  const dateSurvey = body.date_of_survey !== undefined ? body.date_of_survey : existing.date_of_survey;
  const coordinator = body.request_coordinator !== undefined ? body.request_coordinator : existing.request_coordinator;
  let surveyCost = existing.survey_cost;
  if (body.survey_cost !== undefined) {
    const surveyCostVal = validateMonetaryAmount(body.survey_cost, 'Survey cost', false);
    if (!surveyCostVal.valid) {
      return res.status(400).json({ error: surveyCostVal.error, code: surveyCostVal.code });
    }
    surveyCost = surveyCostVal.value!;
  }
  const incidentDesc = body.incident_description !== undefined ? body.incident_description : existing.incident_description;
  const dateIncident = body.date_of_incident !== undefined ? body.date_of_incident : existing.date_of_incident;
  const placeIncident = body.place_of_incident !== undefined ? body.place_of_incident : existing.place_of_incident;
  const cargoType = body.cargo_type !== undefined ? body.cargo_type : existing.cargo_type;
  const damageType = body.nature_of_damage_type !== undefined ? body.nature_of_damage_type : existing.nature_of_damage_type;
  const selectedContainers = body.selected_containers !== undefined ? JSON.stringify(body.selected_containers) : existing.selected_containers;
  const containersWithSizes = body.containers_with_sizes !== undefined ? JSON.stringify(body.containers_with_sizes) : existing.containers_with_sizes;

  let expenseTally = existing.expense_tally_records;
  if (body.expense_tally_records !== undefined) {
    const expenseTallyResult = await recalculateAndSanitizeTallyRecords(body.expense_tally_records, false);
    if (!expenseTallyResult.valid) {
      return res.status(400).json({ error: expenseTallyResult.error, code: expenseTallyResult.code });
    }
    expenseTally = JSON.stringify(expenseTallyResult.records);
  }

  let recoveryTally = existing.recovery_tally_records;
  if (body.recovery_tally_records !== undefined) {
    const recoveryTallyResult = await recalculateAndSanitizeTallyRecords(body.recovery_tally_records, true);
    if (!recoveryTallyResult.valid) {
      return res.status(400).json({ error: recoveryTallyResult.error, code: recoveryTallyResult.code });
    }
    recoveryTally = JSON.stringify(recoveryTallyResult.records);
  }
  const comments = body.comments !== undefined ? JSON.stringify(body.comments) : existing.comments;
  const attachments = body.attachments !== undefined ? JSON.stringify(body.attachments) : existing.attachments;

  // Track changes across important editable survey fields
  if (body.survey_reference_number !== undefined) checkAuditChange('survey_reference_number', existing.survey_reference_number, surveyRef);
  if (body.survey_requested_by !== undefined) checkAuditChange('survey_requested_by', existing.survey_requested_by, reqParty);
  if (body.date_of_survey !== undefined) checkAuditChange('date_of_survey', existing.date_of_survey, dateSurvey);
  if (body.request_coordinator !== undefined) checkAuditChange('request_coordinator', existing.request_coordinator, coordinator);
  if (body.survey_cost !== undefined) checkAuditChange('survey_cost', existing.survey_cost !== null && existing.survey_cost !== undefined ? String(Number(existing.survey_cost)) : '', surveyCost !== null && surveyCost !== undefined ? String(Number(surveyCost)) : '');
  if (body.incident_description !== undefined) checkAuditChange('incident_description', existing.incident_description, incidentDesc);
  if (body.date_of_incident !== undefined) checkAuditChange('date_of_incident', existing.date_of_incident, dateIncident);
  if (body.place_of_incident !== undefined) checkAuditChange('place_of_incident', existing.place_of_incident, placeIncident);
  if (body.cargo_type !== undefined) checkAuditChange('cargo_type', existing.cargo_type, cargoType);
  if (body.nature_of_damage_type !== undefined) checkAuditChange('nature_of_damage_type', existing.nature_of_damage_type, damageType);
  if (body.selected_containers !== undefined) checkAuditChange('selected_containers', stringifyIfObject(existing.selected_containers), selectedContainers);
  if (body.containers_with_sizes !== undefined) checkAuditChange('containers_with_sizes', stringifyIfObject(existing.containers_with_sizes), containersWithSizes);

  // Execute update, audit logs, and claim status sync in a single atomic PostgreSQL transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      UPDATE surveys SET
        survey_status = $1,
        cms_reference_number = $2,
        survey_reference_number = $3,
        survey_requested_by = $4,
        date_of_survey = $5,
        request_coordinator = $6,
        survey_cost = $7,
        incident_description = $8,
        date_of_incident = $9,
        place_of_incident = $10,
        cargo_type = $11,
        nature_of_damage_type = $12,
        selected_containers = $13,
        containers_with_sizes = $14,
        expense_tally_records = $15,
        recovery_tally_records = $16,
        comments = $17,
        attachments = $18,
        updated_date = $19
      WHERE id = $20
    `, [
      finalStatus,
      finalCms,
      surveyRef,
      reqParty,
      dateSurvey,
      coordinator,
      surveyCost,
      incidentDesc,
      dateIncident,
      placeIncident,
      cargoType,
      damageType,
      selectedContainers,
      containersWithSizes,
      expenseTally,
      recoveryTally,
      comments,
      attachments,
      now,
      id
    ]);

    for (const aud of auditEntries) {
      await client.query(
        `INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, field_changed, old_value, new_value, details, created_date)
         VALUES ($1, 'Survey', $2, $3, 'UPDATE', $4, $5, $6, $7, $8, $9, $10)`,
        [
          `aud-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          id,
          existing.survey_number,
          user.id,
          user.full_name,
          aud.field,
          aud.oldVal,
          aud.newVal,
          `Field ${aud.field} changed from ${aud.oldVal} to ${aud.newVal}`,
          now
        ]
      );
    }

    if (isMid && body.survey_status !== undefined && body.survey_status !== existing.survey_status) {
      // Rule 15: Sync survey status to claims inside transaction
      let mappedStatus = 'none';
      if (finalStatus === 'rejected') {
        mappedStatus = 'rejected';
      } else if (finalStatus === 'appointed' || finalStatus === 'accepted') {
        mappedStatus = 'appointed';
      }

      const claimIdsToUpdate = new Set<string>();
      if (existing.claim_id) claimIdsToUpdate.add(existing.claim_id);
      if (existing.originating_claim_id) claimIdsToUpdate.add(existing.originating_claim_id);

      for (const cId of claimIdsToUpdate) {
        await client.query(`
          UPDATE claims SET survey_status = $1, survey_case_number = $2, last_action_date = $3
          WHERE id = $4
        `, [mappedStatus, existing.survey_number, now, cId]);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Survey update transaction error:', err);
    return res.status(500).json({ error: 'Failed to update survey and audit trail.' });
  } finally {
    client.release();
  }

  // Sync attachment metadata for the updated survey
  try {
    const parsedAttachments = parseJSONSafely(attachments, []);
    await syncSurveyAttachments(id as string, existing.survey_number, existing.bl_number, finalCms, parsedAttachments, user.id, user.full_name);
  } catch (err) {
    console.warn('Note: syncSurveyAttachments error on survey update:', err);
  }

  const updated = (await db.prepare('SELECT * FROM surveys WHERE id = ?').get(id)) as any;
  return res.json({
    ...updated,
    selected_containers: parseJSONSafely(updated.selected_containers, []),
    containers_with_sizes: parseJSONSafely(updated.containers_with_sizes, []),
    expense_tally_records: parseJSONSafely(updated.expense_tally_records, []),
    recovery_tally_records: parseJSONSafely(updated.recovery_tally_records, []),
    mail_thread_attachments: parseJSONSafely(updated.mail_thread_attachments, []),
    comments: parseJSONSafely(updated.comments, []),
    attachments: parseJSONSafely(updated.attachments, []),
  });
});

// 6. Audit logs for survey
router.get('/:id/audit', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { id } = req.params;

  const survey = (await db.prepare('SELECT id, created_by_id FROM surveys WHERE id = ?').get(id)) as any;
  if (!survey) {
    return res.status(404).json({ error: 'Survey not found' });
  }

  // RLS check: Agency users must only access audit trails for surveys they own
  if (user.role === 'agency' && survey.created_by_id !== user.id) {
    return res.status(403).json({ error: 'Access denied: You do not have permission to view this survey' });
  }

  const logs = await db.prepare('SELECT * FROM audit_logs WHERE entity_id = ? ORDER BY created_date DESC').all(id);
  return res.json(logs);
});

export default router;
