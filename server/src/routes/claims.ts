import { Router, Response } from 'express';
import { AuthenticatedRequest, authenticate, requireRole } from '../auth';
import db from '../db';

const router = Router();

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

async function generateClaimNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CLM-${year}-`;
  // Extract max sequence from existing claim numbers for this year to avoid collisions
  const rows = (await db.prepare(`SELECT claim_number FROM claims WHERE claim_number LIKE ?`).all(`${prefix}%`)) as { claim_number: string }[];
  let maxSeq = 0;
  for (const row of rows) {
    const seq = parseInt(row.claim_number.replace(prefix, ''), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${(maxSeq + 1).toString().padStart(4, '0')}`;
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

  if (!body.bl_number) {
    return res.status(400).json({ error: 'BL number is required' });
  }
  if (!body.claimant) {
    return res.status(400).json({ error: 'Claimant is required' });
  }

  const claimId = `clm-${Date.now()}`;
  const claimNumber = body.claim_number || (await generateClaimNumber());
  const now = new Date().toISOString();

  // Time bar date auto = 1 year from discharge_date (or 1 year from now)
  let calculatedTimeBar = body.time_bar_date;
  if (!calculatedTimeBar) {
    const baseDate = body.discharge_date ? new Date(body.discharge_date) : new Date();
    const oneYearLater = new Date(baseDate.setFullYear(baseDate.getFullYear() + 1));
    calculatedTimeBar = oneYearLater.toISOString();
  }

  const isMid = ['mid', 'mid_gcc', 'admin'].includes(user.role);

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
    claim_amount: body.claim_amount !== undefined && body.claim_amount !== null ? Number(body.claim_amount) : null,
    claimant: body.claimant,
    claimant_type: body.claimant_type || null,
    status: isMid ? (body.status || 'new_claim') : 'new_claim',
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
    policy_deductible_usd: body.policy_deductible_usd ? Number(body.policy_deductible_usd) : null,
    affiliated_claim_number: body.affiliated_claim_number || null,
    reference_number: body.reference_number || null,
    expense_tally_records: JSON.stringify(body.expense_tally_records || []),
    recovery_tally_records: JSON.stringify(body.recovery_tally_records || []),
    email_thread: JSON.stringify(body.email_thread || []),
    mail_thread_attachments: JSON.stringify(body.mail_thread_attachments || []),
    claim_amount_history: JSON.stringify(
      body.claim_amount ? [{
        old_amount: null,
        new_amount: Number(body.claim_amount),
        user: user.full_name,
        timestamp: now,
        reason: 'Initial claim submission'
      }] : []
    ),
    originating_survey_id: body.originating_survey_id || null,
    originating_survey_number: body.originating_survey_number || null,
    response_received_history: JSON.stringify([]),
    comments: JSON.stringify(body.comments || []),
    attachments: JSON.stringify(body.attachments || []),
    created_by_id: user.id,
    created_by_name: user.full_name,
    created_date: now,
    updated_date: now,
  };

  const stmt = db.prepare(`
    INSERT INTO claims (
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
      @id, @claim_number, @cms_number, @bl_number, @shipper, @consignee, @notify_party,
      @place_of_receipt, @port_of_loading, @port_of_discharge, @place_of_delivery,
      @vessel_code, @vessel_name, @vessel_voyage, @commodity, @container_number,
      @container_size, @seal_number, @weight, @quantity, @package_type, @discharge_date,
      @port_of_landing_date, @port_of_discharge_date, @country, @claim_amount,
      @claimant, @claimant_type, @status, @awaiting_input_reason, @closed_reason,
      @claims_handler, @time_bar_date, @last_action_date, @acknowledged_date,
      @sla_status, @survey_status, @survey_case_number, @incident_description,
      @date_of_incident, @place_of_incident, @cargo_type, @nature_of_damage_category,
      @nature_of_damage_type, @nature_of_damage_dry, @nature_of_damage_reefer,
      @selected_containers, @containers_with_sizes, @policy_deductible_type,
      @policy_pi_club, @policy_number, @policy_deductible_usd,
      @affiliated_claim_number, @reference_number, @expense_tally_records,
      @recovery_tally_records, @email_thread, @mail_thread_attachments,
      @claim_amount_history, @originating_survey_id, @originating_survey_number,
      @response_received_history, @comments, @attachments, @created_by_id,
      @created_by_name, @created_date, @updated_date
    )
  `);

  await stmt.run(newClaim);

  // 1. Audit log
  await db.prepare(`
    INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, details, created_date)
    VALUES (?, 'Claim', ?, ?, 'CREATE', ?, ?, ?, ?)
  `).run(`aud-${Date.now()}`, claimId, claimNumber, user.id, user.full_name, `Claim ${claimNumber} created for BL ${newClaim.bl_number}`, now);

  // 2. Notification for creation
  await db.prepare(`
    INSERT INTO notifications (id, type, message, claim_id, user_id, read, created_date)
    VALUES (?, 'claim', ?, ?, ?, 0, ?)
  `).run(`notif-${Date.now()}`, `New claim ${claimNumber} created by ${user.full_name}`, claimId, user.id, now);

  return res.status(201).json(newClaim);
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

  const now = new Date().toISOString();

  // Audit changes
  const auditEntries: Array<{ field: string; oldVal: string; newVal: string }> = [];

  // Workflow / Status
  let finalStatus = existing.status;
  let finalAwaitingInputReason = existing.awaiting_input_reason;
  let finalClosedReason = existing.closed_reason;
  if (isMid && body.status !== undefined) {
    if (body.status !== existing.status) {
      auditEntries.push({ field: 'status', oldVal: existing.status, newVal: body.status });
      finalStatus = body.status;

      // Notification on closure
      if (body.status === 'closed') {
        await db.prepare(`
          INSERT INTO notifications (id, type, message, claim_id, user_id, read, created_date)
          VALUES (?, 'claim_closure', ?, ?, ?, 0, ?)
        `).run(`notif-${Date.now()}`, `Claim ${existing.claim_number} was closed (${body.closed_reason || 'Settled'})`, id, existing.created_by_id, now);
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
  if (isMid && body.claims_handler !== undefined) {
    if (body.claims_handler !== existing.claims_handler) {
      auditEntries.push({ field: 'claims_handler', oldVal: existing.claims_handler || '', newVal: body.claims_handler });
      finalHandler = body.claims_handler;

      // Notification on handler assignment
      await db.prepare(`
        INSERT INTO notifications (id, type, message, claim_id, user_id, read, created_date)
        VALUES (?, 'handler_assigned', ?, ?, ?, 0, ?)
      `).run(`notif-${Date.now()}`, `Claim ${existing.claim_number} assigned to handler ${body.claims_handler}`, id, existing.created_by_id, now);
    }
  }

  // Time bar date (MID only)
  let finalTimeBar = existing.time_bar_date;
  if (isMid && body.time_bar_date !== undefined) {
    finalTimeBar = body.time_bar_date;
  }

  // Claim Amount (Editable if new claim OR status=new_claim OR user is MID)
  let finalClaimAmount = existing.claim_amount;
  let claimAmountHistory = parseJSONSafely(existing.claim_amount_history, []);
  if (body.claim_amount !== undefined && Number(body.claim_amount) !== Number(existing.claim_amount)) {
    const canEditAmount = isMid || existing.status === 'new_claim';
    if (!canEditAmount) {
      return res.status(403).json({ error: 'Claim amount cannot be modified at this stage' });
    }
    auditEntries.push({ field: 'claim_amount', oldVal: String(existing.claim_amount), newVal: String(body.claim_amount) });
    claimAmountHistory.push({
      old_amount: existing.claim_amount,
      new_amount: Number(body.claim_amount),
      user: user.full_name,
      timestamp: now,
      reason: body.claim_amount_reason || 'Updated via detail view'
    });
    finalClaimAmount = Number(body.claim_amount);
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

  // Other updates
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
  const policyDeductible = body.policy_deductible_usd !== undefined ? (body.policy_deductible_usd ? Number(body.policy_deductible_usd) : null) : existing.policy_deductible_usd;
  const affClaimNum = body.affiliated_claim_number !== undefined ? body.affiliated_claim_number : existing.affiliated_claim_number;
  const refNum = body.reference_number !== undefined ? body.reference_number : existing.reference_number;
  const expenseTally = body.expense_tally_records !== undefined ? JSON.stringify(body.expense_tally_records) : existing.expense_tally_records;
  const recoveryTally = body.recovery_tally_records !== undefined ? JSON.stringify(body.recovery_tally_records) : existing.recovery_tally_records;
  const comments = body.comments !== undefined ? JSON.stringify(body.comments) : existing.comments;
  const attachments = body.attachments !== undefined ? JSON.stringify(body.attachments) : existing.attachments;
  const emailThread = body.email_thread !== undefined ? JSON.stringify(body.email_thread) : existing.email_thread;
  const responseHistory = body.response_received_history !== undefined ? JSON.stringify(body.response_received_history) : existing.response_received_history;
  const userEmail = body.user_email !== undefined ? body.user_email : existing.user_email;
  const vendorEmail = body.vendor_email !== undefined ? body.vendor_email : existing.vendor_email;

  const stmt = db.prepare(`
    UPDATE claims SET
      cms_number = ?,
      status = ?,
      awaiting_input_reason = ?,
      closed_reason = ?,
      claims_handler = ?,
      time_bar_date = ?,
      last_action_date = ?,
      claim_amount = ?,
      claim_amount_history = ?,
      court_case_status = ?,
      court_case_file_reference = ?,
      court_case_location = ?,
      court_case_indicator = ?,
      court_case_jurisdiction = ?,
      court_case_chance_of_winning = ?,
      court_case_file_attachment = ?,
      court_case_attachment_comment = ?,
      port_of_landing_date = ?,
      port_of_discharge_date = ?,
      claimant = ?,
      claimant_type = ?,
      incident_description = ?,
      date_of_incident = ?,
      place_of_incident = ?,
      cargo_type = ?,
      nature_of_damage_type = ?,
      nature_of_damage_category = ?,
      selected_containers = ?,
      containers_with_sizes = ?,
      policy_deductible_type = ?,
      policy_pi_club = ?,
      policy_number = ?,
      policy_deductible_usd = ?,
      affiliated_claim_number = ?,
      reference_number = ?,
      expense_tally_records = ?,
      recovery_tally_records = ?,
      comments = ?,
      attachments = ?,
      email_thread = ?,
      response_received_history = ?,
      user_email = ?,
      vendor_email = ?,
      updated_date = ?
    WHERE id = ?
  `);

  await stmt.run(
    finalCms,
    finalStatus,
    finalAwaitingInputReason,
    finalClosedReason,
    finalHandler,
    finalTimeBar,
    now, // last_action_date auto-updated
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
  );

  // Write audit logs
  for (const aud of auditEntries) {
    await db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, field_changed, old_value, new_value, details, created_date)
      VALUES (?, 'Claim', ?, ?, 'UPDATE', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `aud-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      id,
      existing.claim_number,
      user.id,
      user.full_name,
      aud.field,
      aud.oldVal,
      aud.newVal,
      `Field ${aud.field} changed from ${aud.oldVal} to ${aud.newVal}`,
      now
    );
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
  const { id } = req.params;
  const logs = await db.prepare('SELECT * FROM audit_logs WHERE entity_id = ? ORDER BY created_date DESC').all(id);
  return res.json(logs);
});

export default router;
