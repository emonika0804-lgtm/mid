import { Router, Response } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest, authenticate, requireRole } from '../auth';
import db, { prepareQuery } from '../db';
import { pool } from '../pgdb';
import { syncClaimAttachments } from '../attachmentService';
import { sendEntityCommunicationEmail } from '../emailService';

const router = Router();

export const SUPPORTED_CLAIM_STATUSES = [
  'new_claim',
  'pre_claim',
  'in_progress',
  'awaiting_input',
  'awaiting_approval',
  'closed',
] as const;

export type SupportedClaimStatus = typeof SUPPORTED_CLAIM_STATUSES[number];

export function isValidClaimStatus(status: any): status is SupportedClaimStatus {
  return typeof status === 'string' && (SUPPORTED_CLAIM_STATUSES as readonly string[]).includes(status);
}

export const CLAIM_ADVISORY_LOCK_ID = 20260425;

// Helper to calculate SLA status:
// If closed -> green; if time_bar passed -> red; if >7 days -> red; if >3 days -> amber; else green
function calculateSLA(status: string, timeBarDate?: string, lastActionDate?: string): 'green' | 'amber' | 'red' {
  if (status === 'closed') return 'green';
  const now = Date.now();

  if (timeBarDate) {
    const tb = new Date(timeBarDate).getTime();
    if (!isNaN(tb) && tb < now) return 'red';
  }

  if (lastActionDate) {
    const la = new Date(lastActionDate).getTime();
    if (!isNaN(la)) {
      const daysSinceAction = (now - la) / (1000 * 60 * 60 * 24);
      if (daysSinceAction > 7) return 'red';
      if (daysSinceAction > 3) return 'amber';
    }
  }

  return 'green';
}

export async function generateClaimNumber(existingClient?: any): Promise<string> {
  const client = existingClient || (await pool.connect());
  const shouldRelease = !existingClient;
  try {
    const year = new Date().getFullYear();
    const prefix = `CLM-${year}-`;
    // Extract max sequence from existing claim numbers for this year to avoid collisions
    const res = await client.query(
      `SELECT claim_number FROM claims WHERE claim_number LIKE $1`,
      [`${prefix}%`]
    );
    let maxSeq = 0;
    for (const row of res.rows) {
      const seq = parseInt(row.claim_number.replace(prefix, ''), 10);
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

import {
  MANDATORY_DOCS_DRY_CLAIM,
  MANDATORY_DOCS_REEFER_CLAIM,
  validateClaimMandatoryAttachments,
  validateMandatoryAttachments,
} from '../attachmentValidation';
import {
  validateMonetaryAmount,
  recalculateAndSanitizeTallyRecords,
} from '../financialService';

export {
  MANDATORY_DOCS_DRY_CLAIM,
  MANDATORY_DOCS_REEFER_CLAIM,
  validateClaimMandatoryAttachments,
  validateMandatoryAttachments,
  validateMonetaryAmount,
  recalculateAndSanitizeTallyRecords,
};

// 1. List claims with search and filter, with RLS applied
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { search, status } = req.query;

  let query = 'SELECT * FROM claims WHERE 1=1';
  const params: any[] = [];

  // RLS: Agency users see only their own claims (created_by_id === user.id)
  if (user.role === 'agency') {
    query += ' AND created_by_id = ?';
    params.push(user.id);
  }

  if (status && typeof status === 'string' && status !== 'all') {
    query += ' AND status = ?';
    params.push(status);
  }

  if (search && typeof search === 'string') {
    const s = `%${search.trim().toLowerCase()}%`;
    query += ' AND (LOWER(claim_number) LIKE ? OR LOWER(bl_number) LIKE ? OR LOWER(claimant) LIKE ? OR LOWER(cms_number) LIKE ?)';
    params.push(s, s, s, s);
  }

  query += ' ORDER BY created_date DESC';

  const rows = (await db.prepare(query).all(...params)) as any[];

  const parsedRows = rows.map(r => ({
    ...r,
    selected_containers: parseJSONSafely(r.selected_containers, []),
    containers_with_sizes: parseJSONSafely(r.containers_with_sizes, []),
    expense_tally_records: parseJSONSafely(r.expense_tally_records, []),
    recovery_tally_records: parseJSONSafely(r.recovery_tally_records, []),
    email_thread: parseJSONSafely(r.email_thread, []),
    mail_thread_attachments: parseJSONSafely(r.mail_thread_attachments, []),
    claim_amount_history: parseJSONSafely(r.claim_amount_history, []),
    response_received_history: parseJSONSafely(r.response_received_history, []),
    comments: parseJSONSafely(r.comments, []),
    attachments: parseJSONSafely(r.attachments, []),
    court_case_file_attachment: parseJSONSafely(r.court_case_file_attachment, null),
    sla_status: calculateSLA(r.status, r.time_bar_date, r.last_action_date),
  }));

  return res.json(parsedRows);
});

// 2. Get single claim
router.get('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { id } = req.params;

  const r = (await db.prepare('SELECT * FROM claims WHERE id = ?').get(id)) as any;
  if (!r) {
    return res.status(404).json({ error: 'Claim not found' });
  }

  // RLS check
  if (user.role === 'agency' && r.created_by_id !== user.id) {
    return res.status(403).json({ error: 'Access denied: You do not have permission to view this claim' });
  }

  // Fetch linked surveys
  const linkedSurveys = await db.prepare('SELECT id, survey_number, survey_status, survey_reference_number, created_date FROM surveys WHERE claim_id = ? OR originating_claim_id = ?').all(r.id, r.id);

  const parsed = {
    ...r,
    selected_containers: parseJSONSafely(r.selected_containers, []),
    containers_with_sizes: parseJSONSafely(r.containers_with_sizes, []),
    expense_tally_records: parseJSONSafely(r.expense_tally_records, []),
    recovery_tally_records: parseJSONSafely(r.recovery_tally_records, []),
    email_thread: parseJSONSafely(r.email_thread, []),
    mail_thread_attachments: parseJSONSafely(r.mail_thread_attachments, []),
    claim_amount_history: parseJSONSafely(r.claim_amount_history, []),
    response_received_history: parseJSONSafely(r.response_received_history, []),
    comments: parseJSONSafely(r.comments, []),
    attachments: parseJSONSafely(r.attachments, []),
    court_case_file_attachment: parseJSONSafely(r.court_case_file_attachment, null),
    sla_status: calculateSLA(r.status, r.time_bar_date, r.last_action_date),
    linked_surveys: linkedSurveys,
  };

  return res.json(parsed);
});

// 3. Create new claim
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const body = req.body;

  if (!body.bl_number || (typeof body.bl_number === 'string' && !body.bl_number.trim())) {
    return res.status(400).json({ error: 'BL number is required' });
  }
  if (!body.claimant || (typeof body.claimant === 'string' && !body.claimant.trim())) {
    return res.status(400).json({ error: 'Claimant is required' });
  }

  // 1. Mandatory attachment validation on EVERY claim creation (no conditional bypass)
  const rawAttachments = body.attachments !== undefined
    ? (Array.isArray(body.attachments)
        ? body.attachments
        : typeof body.attachments === 'string'
        ? parseJSONSafely(body.attachments, [])
        : [])
    : [];

  const effectiveCargoType = body.cargo_type || 'dry';
  const validation = validateClaimMandatoryAttachments(rawAttachments, effectiveCargoType);
  if (!validation.valid) {
    return res.status(400).json({
      error: `Mandatory attachment validation failed: The following document(s) require either an uploaded file or a missing-document reason: ${validation.missing.join(', ')}`,
      code: 'INCOMPLETE_MANDATORY_ATTACHMENTS',
      missing_documents: validation.missing,
    });
  }

  // 2. Validate status if provided
  const isMid = ['mid', 'mid_gcc', 'admin'].includes(user.role);
  let initialStatus = 'new_claim';
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !isValidClaimStatus(body.status)) {
      return res.status(400).json({
        error: `Invalid claim status: ${body.status}. Supported statuses are: ${SUPPORTED_CLAIM_STATUSES.join(', ')}`,
      });
    }
    if (isMid) {
      initialStatus = body.status;
    }
  }

  // 3. Monetary input validation (FIN-04) and calculation integrity (FIN-02)
  const claimAmountVal = validateMonetaryAmount(body.claim_amount, 'Claim amount', true);
  if (!claimAmountVal.valid) {
    return res.status(400).json({ error: claimAmountVal.error, code: claimAmountVal.code });
  }

  const policyDeductibleVal = validateMonetaryAmount(body.policy_deductible_usd, 'Policy deductible', true);
  if (!policyDeductibleVal.valid) {
    return res.status(400).json({ error: policyDeductibleVal.error, code: policyDeductibleVal.code });
  }

  const expenseTallyResult = await recalculateAndSanitizeTallyRecords(body.expense_tally_records, false);
  if (!expenseTallyResult.valid) {
    return res.status(400).json({ error: expenseTallyResult.error, code: expenseTallyResult.code });
  }

  const recoveryTallyResult = await recalculateAndSanitizeTallyRecords(body.recovery_tally_records, true);
  if (!recoveryTallyResult.valid) {
    return res.status(400).json({ error: recoveryTallyResult.error, code: recoveryTallyResult.code });
  }

  // Time bar date auto = 1 year from discharge_date (or 1 year from now)
  let calculatedTimeBar = body.time_bar_date;
  if (!calculatedTimeBar) {
    const baseDate = body.discharge_date ? new Date(body.discharge_date) : new Date();
    const oneYearLater = new Date(baseDate.setFullYear(baseDate.getFullYear() + 1));
    calculatedTimeBar = oneYearLater.toISOString();
  }

  const now = new Date().toISOString();

  // 3. Concurrency-safe atomic claim creation
  let createdClaim: any = null;
  const maxRetries = 5;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Concurrency lock for claim number generation
      await client.query('SELECT pg_advisory_xact_lock($1)', [CLAIM_ADVISORY_LOCK_ID]);

      // Server-side atomic sequential claim number generation (never trust or accept client-supplied claim_number)
      const claimNumber = await generateClaimNumber(client);
      const claimId = `clm-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      const newClaim = {
        id: claimId,
        claim_number: claimNumber,
        cms_number: isMid ? (body.cms_number || null) : null,
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
        claim_amount: claimAmountVal.value !== undefined ? claimAmountVal.value : null,
        claimant: body.claimant,
        claimant_type: body.claimant_type || null,
        status: initialStatus,
        awaiting_input_reason: body.awaiting_input_reason || '',
        closed_reason: body.closed_reason || '',
        claims_handler: isMid ? (body.claims_handler || null) : null,
        time_bar_date: calculatedTimeBar,
        last_action_date: now,
        acknowledged_date: now,
        sla_status: 'green',
        survey_status: body.survey_status || 'none',
        survey_case_number: body.survey_case_number || null,
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
        policy_deductible_type: body.policy_deductible_type || null,
        policy_pi_club: body.policy_pi_club || null,
        policy_number: body.policy_number || null,
        policy_deductible_usd: policyDeductibleVal.value !== undefined ? policyDeductibleVal.value : null,
        affiliated_claim_number: body.affiliated_claim_number || null,
        reference_number: body.reference_number || null,
        expense_tally_records: JSON.stringify(expenseTallyResult.records || []),
        recovery_tally_records: JSON.stringify(recoveryTallyResult.records || []),
        email_thread: JSON.stringify(body.email_thread || []),
        mail_thread_attachments: JSON.stringify(body.mail_thread_attachments || []),
        claim_amount_history: JSON.stringify(
          claimAmountVal.value !== undefined && claimAmountVal.value !== null ? [{
            old_amount: null,
            new_amount: claimAmountVal.value,
            user: user.full_name,
            timestamp: now,
            reason: 'Initial claim submission'
          }] : []
        ),
        originating_survey_id: body.originating_survey_id || null,
        originating_survey_number: body.originating_survey_number || null,
        response_received_history: JSON.stringify([]),
        comments: JSON.stringify(body.comments || []),
        attachments: JSON.stringify(rawAttachments),
        created_by_id: user.id,
        created_by_name: user.full_name,
        created_date: now,
        updated_date: now,
      };

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
          newClaim.id, newClaim.claim_number, newClaim.cms_number, newClaim.bl_number, newClaim.shipper, newClaim.consignee, newClaim.notify_party,
          newClaim.place_of_receipt, newClaim.port_of_loading, newClaim.port_of_discharge, newClaim.place_of_delivery,
          newClaim.vessel_code, newClaim.vessel_name, newClaim.vessel_voyage, newClaim.commodity, newClaim.container_number,
          newClaim.container_size, newClaim.seal_number, newClaim.weight, newClaim.quantity, newClaim.package_type, newClaim.discharge_date,
          newClaim.port_of_landing_date, newClaim.port_of_discharge_date, newClaim.country, newClaim.claim_amount,
          newClaim.claimant, newClaim.claimant_type, newClaim.status, newClaim.awaiting_input_reason, newClaim.closed_reason,
          newClaim.claims_handler, newClaim.time_bar_date, newClaim.last_action_date, newClaim.acknowledged_date,
          newClaim.sla_status, newClaim.survey_status, newClaim.survey_case_number, newClaim.incident_description,
          newClaim.date_of_incident, newClaim.place_of_incident, newClaim.cargo_type, newClaim.nature_of_damage_category,
          newClaim.nature_of_damage_type, newClaim.nature_of_damage_dry, newClaim.nature_of_damage_reefer,
          newClaim.selected_containers, newClaim.containers_with_sizes, newClaim.policy_deductible_type,
          newClaim.policy_pi_club, newClaim.policy_number, newClaim.policy_deductible_usd,
          newClaim.affiliated_claim_number, newClaim.reference_number, newClaim.expense_tally_records,
          newClaim.recovery_tally_records, newClaim.email_thread, newClaim.mail_thread_attachments,
          newClaim.claim_amount_history, newClaim.originating_survey_id, newClaim.originating_survey_number,
          newClaim.response_received_history, newClaim.comments, newClaim.attachments, newClaim.created_by_id,
          newClaim.created_by_name, newClaim.created_date, newClaim.updated_date
        ]
      );

      // Audit log in same transaction
      await client.query(
        `INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, details, created_date)
         VALUES ($1, 'Claim', $2, $3, 'CREATE', $4, $5, $6, $7)`,
        [`aud-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`, newClaim.id, newClaim.claim_number, user.id, user.full_name, `Claim ${newClaim.claim_number} created for BL ${newClaim.bl_number}`, now]
      );

      // Notification in same transaction
      await client.query(
        `INSERT INTO notifications (id, type, message, claim_id, user_id, read, created_date)
         VALUES ($1, 'claim', $2, $3, $4, 0, $5)`,
        [`notif-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`, `New claim ${newClaim.claim_number} created by ${user.full_name}`, newClaim.id, user.id, now]
      );

      await client.query('COMMIT');
      createdClaim = newClaim;
      break;
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err.code === '23505' && attempt < maxRetries) {
        continue;
      }
      console.error('Claim creation database error:', err);
      return res.status(500).json({ error: 'Failed to create claim record.' });
    } finally {
      client.release();
    }
  }

  if (!createdClaim) {
    return res.status(500).json({ error: 'Failed to generate unique claim number after multiple attempts.' });
  }

  // Sync attachment metadata for the new claim
  try {
    const parsedAttachments = parseJSONSafely(createdClaim.attachments, []);
    await syncClaimAttachments(createdClaim.id, createdClaim.claim_number, createdClaim.bl_number, createdClaim.cms_number, parsedAttachments, user.id, user.full_name);
  } catch (err) {
    console.warn('Note: syncClaimAttachments error on claim creation:', err);
  }

  return res.status(201).json(createdClaim);
});

// 4. Update claim
router.put('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { id } = req.params;
  const body = req.body;

  const existing = (await db.prepare('SELECT * FROM claims WHERE id = ?').get(id)) as any;
  if (!existing) {
    return res.status(404).json({ error: 'Claim not found' });
  }

  const isMid = ['mid', 'mid_gcc', 'admin'].includes(user.role);
  const isOwner = existing.created_by_id === user.id;

  if (!isMid && !isOwner) {
    return res.status(403).json({ error: 'Access denied: You cannot edit this claim' });
  }

  // 1. Status whitelist validation
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !isValidClaimStatus(body.status)) {
      return res.status(400).json({
        error: `Invalid claim status: ${body.status}. Supported statuses are: ${SUPPORTED_CLAIM_STATUSES.join(', ')}`,
      });
    }
  }

  // Reject clearing or whitespace on mandatory fields
  if (body.bl_number !== undefined && (typeof body.bl_number !== 'string' || !body.bl_number.trim())) {
    return res.status(400).json({ error: 'BL number cannot be empty' });
  }
  if (body.claimant !== undefined && (typeof body.claimant !== 'string' || !body.claimant.trim())) {
    return res.status(400).json({ error: 'Claimant cannot be empty' });
  }
  if (body.place_of_incident !== undefined && (typeof body.place_of_incident !== 'string' || !body.place_of_incident.trim())) {
    return res.status(400).json({ error: 'Place of incident cannot be empty' });
  }
  if (body.date_of_incident !== undefined && (typeof body.date_of_incident !== 'string' || !body.date_of_incident.trim())) {
    return res.status(400).json({ error: 'Date of incident cannot be empty' });
  }
  if (body.incident_description !== undefined && (typeof body.incident_description !== 'string' || !body.incident_description.trim())) {
    return res.status(400).json({ error: 'Incident description cannot be empty' });
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
    const validation = validateClaimMandatoryAttachments(rawAttachments, effectiveCargoType);

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

  // Workflow / Status
  let finalStatus = existing.status;
  let finalAwaitingInputReason = existing.awaiting_input_reason;
  let finalClosedReason = existing.closed_reason;
  let closureNotification: string | null = null;
  if (isMid && body.status !== undefined) {
    if (body.status !== existing.status) {
      auditEntries.push({ field: 'status', oldVal: existing.status, newVal: body.status });
      finalStatus = body.status;

      if (body.status === 'closed') {
        closureNotification = `Claim ${existing.claim_number} was closed (${body.closed_reason || 'Settled'})`;
      }
    }
    finalAwaitingInputReason = body.awaiting_input_reason || '';
    finalClosedReason = body.closed_reason || '';
  }

  // CMS Number (MID only)
  let finalCms = existing.cms_number;
  if (isMid && body.cms_number !== undefined) {
    if (body.cms_number !== existing.cms_number) {
      auditEntries.push({ field: 'cms_number', oldVal: existing.cms_number || '', newVal: body.cms_number });
      finalCms = body.cms_number;
    }
  }

  // Claims Handler (MID only)
  let finalHandler = existing.claims_handler;
  let handlerNotification: string | null = null;
  if (isMid && body.claims_handler !== undefined) {
    if (body.claims_handler !== existing.claims_handler) {
      auditEntries.push({ field: 'claims_handler', oldVal: existing.claims_handler || '', newVal: body.claims_handler });
      finalHandler = body.claims_handler;
      handlerNotification = `Claim ${existing.claim_number} assigned to handler ${body.claims_handler}`;
    }
  }

  // Time bar date (MID only)
  let finalTimeBar = existing.time_bar_date;
  if (isMid && body.time_bar_date !== undefined) {
    if (body.time_bar_date !== existing.time_bar_date) {
      auditEntries.push({ field: 'time_bar_date', oldVal: existing.time_bar_date || '', newVal: body.time_bar_date || '' });
    }
    finalTimeBar = body.time_bar_date;
  }

  // Claim Amount (Editable if new claim OR status=new_claim OR user is MID)
  let finalClaimAmount = existing.claim_amount;
  let claimAmountHistory = parseJSONSafely(existing.claim_amount_history, []);
  if (body.claim_amount !== undefined) {
    const claimAmountVal = validateMonetaryAmount(body.claim_amount, 'Claim amount', false);
    if (!claimAmountVal.valid) {
      return res.status(400).json({ error: claimAmountVal.error, code: claimAmountVal.code });
    }
    if (claimAmountVal.value !== Number(existing.claim_amount)) {
      const canEditAmount = isMid || existing.status === 'new_claim';
      if (!canEditAmount) {
        return res.status(403).json({ error: 'Claim amount cannot be modified at this stage' });
      }
      auditEntries.push({ field: 'claim_amount', oldVal: String(existing.claim_amount), newVal: String(claimAmountVal.value) });
      claimAmountHistory.push({
        old_amount: existing.claim_amount,
        new_amount: claimAmountVal.value!,
        user: user.full_name,
        timestamp: now,
        reason: body.claim_amount_reason || 'Updated via detail view'
      });
      finalClaimAmount = claimAmountVal.value!;
    }
  }

  // Court case fields
  const courtCaseStatus = body.court_case_status !== undefined ? body.court_case_status : existing.court_case_status;
  const courtCaseFileRef = body.court_case_file_reference !== undefined ? body.court_case_file_reference : existing.court_case_file_reference;
  const courtCaseLocation = body.court_case_location !== undefined ? body.court_case_location : existing.court_case_location;
  const courtCaseIndicator = body.court_case_indicator !== undefined ? body.court_case_indicator : existing.court_case_indicator;
  const courtCaseJurisdiction = body.court_case_jurisdiction !== undefined ? body.court_case_jurisdiction : existing.court_case_jurisdiction;
  const courtCaseChance = body.court_case_chance_of_winning !== undefined ? body.court_case_chance_of_winning : existing.court_case_chance_of_winning;
  const courtCaseAttachment = body.court_case_file_attachment !== undefined ? JSON.stringify(body.court_case_file_attachment) : existing.court_case_file_attachment;
  const courtCaseComment = body.court_case_attachment_comment !== undefined ? body.court_case_attachment_comment : existing.court_case_attachment_comment;

  // Other updates & expanded comprehensive audit tracking
  const portLandingDate = body.port_of_landing_date !== undefined ? body.port_of_landing_date : existing.port_of_landing_date;
  const portDischargeDate = body.port_of_discharge_date !== undefined ? body.port_of_discharge_date : existing.port_of_discharge_date;
  const claimant = body.claimant !== undefined ? body.claimant : existing.claimant;
  const claimantType = body.claimant_type !== undefined ? body.claimant_type : existing.claimant_type;
  const incidentDesc = body.incident_description !== undefined ? body.incident_description : existing.incident_description;
  const dateIncident = body.date_of_incident !== undefined ? body.date_of_incident : existing.date_of_incident;
  const placeIncident = body.place_of_incident !== undefined ? body.place_of_incident : existing.place_of_incident;
  const cargoType = body.cargo_type !== undefined ? body.cargo_type : existing.cargo_type;
  const damageType = body.nature_of_damage_type !== undefined ? body.nature_of_damage_type : existing.nature_of_damage_type;
  const damageCategory = body.nature_of_damage_category !== undefined ? body.nature_of_damage_category : existing.nature_of_damage_category;

  const selectedContainers = body.selected_containers !== undefined ? JSON.stringify(body.selected_containers) : existing.selected_containers;
  const containersWithSizes = body.containers_with_sizes !== undefined ? JSON.stringify(body.containers_with_sizes) : existing.containers_with_sizes;
  const policyType = body.policy_deductible_type !== undefined ? body.policy_deductible_type : existing.policy_deductible_type;
  const policyClub = body.policy_pi_club !== undefined ? body.policy_pi_club : existing.policy_pi_club;
  const policyNum = body.policy_number !== undefined ? body.policy_number : existing.policy_number;
  let policyDeductible = existing.policy_deductible_usd;
  if (body.policy_deductible_usd !== undefined) {
    const deductibleVal = validateMonetaryAmount(body.policy_deductible_usd, 'Policy deductible', true);
    if (!deductibleVal.valid) {
      return res.status(400).json({ error: deductibleVal.error, code: deductibleVal.code });
    }
    policyDeductible = deductibleVal.value !== undefined ? deductibleVal.value : null;
  }
  const affClaimNum = body.affiliated_claim_number !== undefined ? body.affiliated_claim_number : existing.affiliated_claim_number;
  const refNum = body.reference_number !== undefined ? body.reference_number : existing.reference_number;

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
  const emailThread = body.email_thread !== undefined ? JSON.stringify(body.email_thread) : existing.email_thread;
  const responseHistory = body.response_received_history !== undefined ? JSON.stringify(body.response_received_history) : existing.response_received_history;
  const userEmail = body.user_email !== undefined ? body.user_email : existing.user_email;
  const vendorEmail = body.vendor_email !== undefined ? body.vendor_email : existing.vendor_email;

  // Track changes to claimant details
  if (body.claimant !== undefined) checkAuditChange('claimant', existing.claimant, claimant);
  if (body.claimant_type !== undefined) checkAuditChange('claimant_type', existing.claimant_type, claimantType);

  // Track changes to incident details
  if (body.incident_description !== undefined) checkAuditChange('incident_description', existing.incident_description, incidentDesc);
  if (body.date_of_incident !== undefined) checkAuditChange('date_of_incident', existing.date_of_incident, dateIncident);
  if (body.place_of_incident !== undefined) checkAuditChange('place_of_incident', existing.place_of_incident, placeIncident);
  if (body.cargo_type !== undefined) checkAuditChange('cargo_type', existing.cargo_type, cargoType);
  if (body.nature_of_damage_type !== undefined) checkAuditChange('nature_of_damage_type', existing.nature_of_damage_type, damageType);
  if (body.nature_of_damage_category !== undefined) checkAuditChange('nature_of_damage_category', existing.nature_of_damage_category, damageCategory);

  // Track changes to container mappings
  if (body.selected_containers !== undefined) checkAuditChange('selected_containers', stringifyIfObject(existing.selected_containers), selectedContainers);
  if (body.containers_with_sizes !== undefined) checkAuditChange('containers_with_sizes', stringifyIfObject(existing.containers_with_sizes), containersWithSizes);

  // Track changes to policy deductibles
  if (body.policy_number !== undefined) checkAuditChange('policy_number', existing.policy_number, policyNum);
  if (body.policy_pi_club !== undefined) checkAuditChange('policy_pi_club', existing.policy_pi_club, policyClub);
  if (body.policy_deductible_type !== undefined) checkAuditChange('policy_deductible_type', existing.policy_deductible_type, policyType);
  if (body.policy_deductible_usd !== undefined) checkAuditChange('policy_deductible_usd', existing.policy_deductible_usd !== null && existing.policy_deductible_usd !== undefined ? String(Number(existing.policy_deductible_usd)) : '', policyDeductible !== null && policyDeductible !== undefined ? String(Number(policyDeductible)) : '');

  const updateSql = `
    UPDATE claims SET
      cms_number = $1,
      status = $2,
      awaiting_input_reason = $3,
      closed_reason = $4,
      claims_handler = $5,
      time_bar_date = $6,
      last_action_date = $7,
      claim_amount = $8,
      claim_amount_history = $9,
      court_case_status = $10,
      court_case_file_reference = $11,
      court_case_location = $12,
      court_case_indicator = $13,
      court_case_jurisdiction = $14,
      court_case_chance_of_winning = $15,
      court_case_file_attachment = $16,
      court_case_attachment_comment = $17,
      port_of_landing_date = $18,
      port_of_discharge_date = $19,
      claimant = $20,
      claimant_type = $21,
      incident_description = $22,
      date_of_incident = $23,
      place_of_incident = $24,
      cargo_type = $25,
      nature_of_damage_type = $26,
      nature_of_damage_category = $27,
      selected_containers = $28,
      containers_with_sizes = $29,
      policy_deductible_type = $30,
      policy_pi_club = $31,
      policy_number = $32,
      policy_deductible_usd = $33,
      affiliated_claim_number = $34,
      reference_number = $35,
      expense_tally_records = $36,
      recovery_tally_records = $37,
      comments = $38,
      attachments = $39,
      email_thread = $40,
      response_received_history = $41,
      user_email = $42,
      vendor_email = $43,
      updated_date = $44
    WHERE id = $45
  `;

  const updateValues = [
    finalCms,
    finalStatus,
    finalAwaitingInputReason,
    finalClosedReason,
    finalHandler,
    finalTimeBar,
    now,
    finalClaimAmount,
    JSON.stringify(claimAmountHistory),
    courtCaseStatus,
    courtCaseFileRef,
    courtCaseLocation,
    courtCaseIndicator,
    courtCaseJurisdiction,
    courtCaseChance,
    courtCaseAttachment,
    courtCaseComment,
    portLandingDate,
    portDischargeDate,
    claimant,
    claimantType,
    incidentDesc,
    dateIncident,
    placeIncident,
    cargoType,
    damageType,
    damageCategory,
    selectedContainers,
    containersWithSizes,
    policyType,
    policyClub,
    policyNum,
    policyDeductible,
    affClaimNum,
    refNum,
    expenseTally,
    recoveryTally,
    comments,
    attachments,
    emailThread,
    responseHistory,
    userEmail,
    vendorEmail,
    now,
    id
  ];

  // Execute update, audit logs, and notifications atomically in a single PostgreSQL transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(updateSql, updateValues);

    for (const aud of auditEntries) {
      await client.query(
        `INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, field_changed, old_value, new_value, details, created_date)
         VALUES ($1, 'Claim', $2, $3, 'UPDATE', $4, $5, $6, $7, $8, $9, $10)`,
        [
          `aud-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
          id,
          existing.claim_number,
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

    if (closureNotification) {
      await client.query(
        `INSERT INTO notifications (id, type, message, claim_id, user_id, read, created_date)
         VALUES ($1, 'claim_closure', $2, $3, $4, 0, $5)`,
        [`notif-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`, closureNotification, id, existing.created_by_id, now]
      );
    }

    if (handlerNotification) {
      await client.query(
        `INSERT INTO notifications (id, type, message, claim_id, user_id, read, created_date)
         VALUES ($1, 'handler_assigned', $2, $3, $4, 0, $5)`,
        [`notif-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`, handlerNotification, id, existing.created_by_id, now]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Claim update transaction error:', err);
    return res.status(500).json({ error: 'Failed to update claim and audit trail.' });
  } finally {
    client.release();
  }

  // Sync attachment metadata for the updated claim
  try {
    const parsedAttachments = parseJSONSafely(body.attachments, []);
    await syncClaimAttachments(id as string, existing.claim_number, existing.bl_number, finalCms, parsedAttachments, user.id, user.full_name);
  } catch (err) {
    console.warn('Note: syncClaimAttachments error on claim update:', err);
  }

  // Dispatch outgoing email communications if new messages were appended to email_thread
  if (body.email_thread && Array.isArray(body.email_thread)) {
    const existingThread = parseJSONSafely(existing.email_thread, []);
    if (body.email_thread.length > existingThread.length) {
      const newMessages = body.email_thread.slice(existingThread.length);
      for (const msg of newMessages) {
        if (msg.direction === 'sent' && msg.to_email) {
          sendEntityCommunicationEmail({
            to: msg.to_email,
            from: msg.from_email || user.email,
            subject: msg.subject || `[PIL Claims] ${existing.claim_number} - BL: ${existing.bl_number}`,
            body: msg.body || '',
            referenceId: existing.id,
            referenceType: 'claim',
            referenceNumber: existing.claim_number,
            blNumber: existing.bl_number,
            attachments: msg.attachments,
          }).catch((err) => {
            console.warn('[Claims] Outgoing email dispatch note:', err?.message || err);
          });
        }
      }
    }
  }

  const updated = (await db.prepare('SELECT * FROM claims WHERE id = ?').get(id)) as any;
  return res.json({
    ...updated,
    selected_containers: parseJSONSafely(updated.selected_containers, []),
    containers_with_sizes: parseJSONSafely(updated.containers_with_sizes, []),
    expense_tally_records: parseJSONSafely(updated.expense_tally_records, []),
    recovery_tally_records: parseJSONSafely(updated.recovery_tally_records, []),
    email_thread: parseJSONSafely(updated.email_thread, []),
    mail_thread_attachments: parseJSONSafely(updated.mail_thread_attachments, []),
    claim_amount_history: parseJSONSafely(updated.claim_amount_history, []),
    response_received_history: parseJSONSafely(updated.response_received_history, []),
    comments: parseJSONSafely(updated.comments, []),
    attachments: parseJSONSafely(updated.attachments, []),
    court_case_file_attachment: parseJSONSafely(updated.court_case_file_attachment, null),
    sla_status: calculateSLA(updated.status, updated.time_bar_date, updated.last_action_date),
  });
});

// 5. Delete claim (MID/Admin only)
router.delete('/:id', authenticate, requireRole(['mid', 'mid_gcc', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  const existing = (await db.prepare('SELECT * FROM claims WHERE id = ?').get(id)) as any;
  if (!existing) {
    return res.status(404).json({ error: 'Claim not found' });
  }

  await db.prepare('DELETE FROM claims WHERE id = ?').run(id);

  await db.prepare(`
    INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, details, created_date)
    VALUES (?, 'Claim', ?, ?, 'DELETE', ?, ?, ?, ?)
  `).run(`aud-${Date.now()}`, id, existing.claim_number, user.id, user.full_name, `Claim ${existing.claim_number} deleted`, new Date().toISOString());

  return res.json({ message: 'Claim deleted successfully' });
});

// 6. Audit logs for claim
router.get('/:id/audit', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { id } = req.params;

  const claim = (await db.prepare('SELECT id, created_by_id FROM claims WHERE id = ?').get(id)) as any;
  if (!claim) {
    return res.status(404).json({ error: 'Claim not found' });
  }

  // RLS check: Agency users must only access audit trails for claims they own
  if (user.role === 'agency' && claim.created_by_id !== user.id) {
    return res.status(403).json({ error: 'Access denied: You do not have permission to view this claim' });
  }

  const logs = await db.prepare('SELECT * FROM audit_logs WHERE entity_id = ? ORDER BY created_date DESC').all(id);
  return res.json(logs);
});

export default router;
