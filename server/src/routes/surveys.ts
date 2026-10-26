import { Router, Response } from 'express';
import { AuthenticatedRequest, authenticate, requireRole } from '../auth';
import db from '../db';

const router = Router();

async function generateSurveyNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SVY-${year}-`;
  const rows = (await db.prepare(`SELECT survey_number FROM surveys WHERE survey_number LIKE ?`).all(`${prefix}%`)) as { survey_number: string }[];
  let maxSeq = 0;
  for (const row of rows) {
    const seq = parseInt(row.survey_number.replace(prefix, ''), 10);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${(maxSeq + 1).toString().padStart(4, '0')}`;
}

async function generateClaimNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CLM-${year}-`;
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
// Only when survey_status=appointed AND converted_to_claim_id is null AND user is MID
router.post('/:id/convert-to-claim', authenticate, requireRole(['mid', 'mid_gcc', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { id } = req.params;

  const survey = (await db.prepare('SELECT * FROM surveys WHERE id = ?').get(id)) as any;
  if (!survey) {
    return res.status(404).json({ error: 'Survey not found' });
  }

  if (survey.survey_status !== 'appointed' && survey.survey_status !== 'accepted') {
    return res.status(400).json({ error: 'Survey must be appointed or accepted before converting to claim' });
  }

  if (survey.converted_to_claim_id) {
    return res.status(400).json({ error: `Survey has already been converted to claim ${survey.converted_to_claim_number}` });
  }

  const claimId = `clm-${Date.now()}`;
  // Generate a unique claim number using MAX-based sequence
  const claimNumber = await generateClaimNumber();
  const now = new Date().toISOString();

  // Time bar = 1 year from discharge_date
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

  // Create claim copying all data
  await db.prepare(`
    INSERT INTO claims (
      id, claim_number, cms_number, bl_number, shipper, consignee, notify_party,
      place_of_receipt, port_of_loading, port_of_discharge, place_of_delivery,
      vessel_code, vessel_name, vessel_voyage, commodity, container_number,
      container_size, seal_number, weight, quantity, package_type, discharge_date,
      port_of_landing_date, port_of_discharge_date, country, claim_amount,
      claimant, claimant_type, status,
      time_bar_date, last_action_date, acknowledged_date,
      sla_status, survey_status, survey_case_number, incident_description,
      date_of_incident, place_of_incident, cargo_type, nature_of_damage_type,
      selected_containers, containers_with_sizes,
      originating_survey_id, originating_survey_number,
      comments, attachments, expense_tally_records, recovery_tally_records,
      created_by_id, created_by_name, created_date, updated_date
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, 'new_claim',
      ?, ?, ?,
      'green', 'appointed', ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `).run(
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
    calculatedTimeBar,
    now,
    now,
    survey.survey_number,
    survey.incident_description,
    survey.date_of_incident,
    survey.place_of_incident,
    survey.cargo_type,
    survey.nature_of_damage_type,
    survey.selected_containers,
    survey.containers_with_sizes,
    survey.id,
    survey.survey_number,
    survey.comments,
    survey.attachments,
    survey.expense_tally_records,
    survey.recovery_tally_records,
    user.id,
    user.full_name,
    now,
    now
  );

  // Update survey with converted links
  await db.prepare(`
    UPDATE surveys SET converted_to_claim_id = ?, converted_to_claim_number = ?, updated_date = ?
    WHERE id = ?
  `).run(claimId, claimNumber, now, id);

  // Audit logs on both
  await db.prepare(`
    INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, details, created_date)
    VALUES (?, 'Survey', ?, ?, 'CONVERT', ?, ?, ?, ?)
  `).run(`aud-${Date.now()}-s`, id, survey.survey_number, user.id, user.full_name, `Survey ${survey.survey_number} converted to Claim ${claimNumber}`, now);

  await db.prepare(`
    INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, details, created_date)
    VALUES (?, 'Claim', ?, ?, 'CREATE', ?, ?, ?, ?)
  `).run(`aud-${Date.now()}-c`, claimId, claimNumber, user.id, user.full_name, `Claim created from Survey ${survey.survey_number}`, now);

  return res.json({
    message: 'Survey successfully converted to claim',
    claim_id: claimId,
    claim_number: claimNumber,
  });
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

  if (!body.bl_number) {
    return res.status(400).json({ error: 'BL number is required' });
  }
  if (!body.survey_reference_number) {
    return res.status(400).json({ error: 'Survey Reference Number is required' });
  }
  if (!body.survey_requested_by) {
    return res.status(400).json({ error: 'Survey Requested By is required' });
  }
  if (!body.date_of_survey) {
    return res.status(400).json({ error: 'Date of Survey is required' });
  }
  if (body.survey_cost === undefined || body.survey_cost === null || isNaN(Number(body.survey_cost))) {
    return res.status(400).json({ error: 'Survey Cost is required' });
  }

  const isMid = ['mid', 'mid_gcc', 'admin'].includes(user.role);
  if (isMid && !body.cms_reference_number) {
    return res.status(400).json({ error: 'CMS Reference Number is required for MID submission' });
  }

  const surveyId = `svy-${Date.now()}`;
  const surveyNumber = await generateSurveyNumber();
  const now = new Date().toISOString();

  const newSurvey = {
    id: surveyId,
    survey_number: surveyNumber,
    survey_created_date: now,
    survey_requested_by: body.survey_requested_by,
    survey_status: body.survey_status || 'new_survey',
    survey_reference_number: body.survey_reference_number,
    cms_reference_number: isMid ? (body.cms_reference_number || null) : null,
    date_of_survey: body.date_of_survey,
    request_coordinator: body.request_coordinator || null,
    survey_cost: Number(body.survey_cost),
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
    attachments: JSON.stringify(body.attachments || []),
    expense_tally_records: JSON.stringify(body.expense_tally_records || []),
    recovery_tally_records: JSON.stringify(body.recovery_tally_records || []),
    created_by_id: user.id,
    created_by_name: user.full_name,
    created_date: now,
    updated_date: now,
  };

  const stmt = db.prepare(`
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
      @id, @survey_number, @survey_created_date, @survey_requested_by, @survey_status,
      @survey_reference_number, @cms_reference_number, @date_of_survey, @request_coordinator,
      @survey_cost, @bl_number, @shipper, @consignee, @notify_party, @place_of_receipt,
      @port_of_loading, @port_of_discharge, @place_of_delivery, @vessel_code, @vessel_name,
      @vessel_voyage, @commodity, @container_number, @container_size, @seal_number,
      @weight, @quantity, @package_type, @discharge_date, @port_of_landing_date,
      @port_of_discharge_date, @country, @incident_description, @date_of_incident,
      @place_of_incident, @cargo_type, @nature_of_damage_category, @nature_of_damage_type,
      @nature_of_damage_dry, @nature_of_damage_reefer, @selected_containers,
      @containers_with_sizes, @claim_id, @originating_claim_id, @originating_claim_number,
      @converted_to_claim_id, @converted_to_claim_number, @mail_thread_attachments,
      @comments, @attachments, @expense_tally_records, @recovery_tally_records,
      @created_by_id, @created_by_name, @created_date, @updated_date
    )
  `);

  await stmt.run(newSurvey);

  // Business Rule 13: If created from claim (reroute), update claim's survey_status to "appointed" and survey_case_number to new survey number
  if (body.originating_claim_id || body.claim_id) {
    const claimTargetId = body.originating_claim_id || body.claim_id;
    await db.prepare(`
      UPDATE claims SET survey_status = 'appointed', survey_case_number = ?, last_action_date = ?
      WHERE id = ?
    `).run(surveyNumber, now, claimTargetId);
  }

  // Audit log
  await db.prepare(`
    INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, details, created_date)
    VALUES (?, 'Survey', ?, ?, 'CREATE', ?, ?, ?, ?)
  `).run(`aud-${Date.now()}`, surveyId, surveyNumber, user.id, user.full_name, `Survey request ${surveyNumber} created for BL ${newSurvey.bl_number}`, now);

  return res.status(201).json(newSurvey);
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

  const now = new Date().toISOString();

  // Status can only be changed by MID (Rule: agency cannot update survey status)
  let finalStatus = existing.survey_status;
  if (isMid && body.survey_status !== undefined && body.survey_status !== existing.survey_status) {
    finalStatus = body.survey_status;
    // Rule 15: Sync survey status to claims
    await syncSurveyStatusToClaims(existing, finalStatus);

    await db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, entity_number, action, performed_by, performed_by_name, field_changed, old_value, new_value, details, created_date)
      VALUES (?, 'Survey', ?, ?, 'UPDATE', ?, ?, 'survey_status', ?, ?, 'Survey status updated', ?)
    `).run(`aud-${Date.now()}`, id, existing.survey_number, user.id, user.full_name, existing.survey_status, finalStatus, now);
  }

  // CMS number (MID only)
  let finalCms = existing.cms_reference_number;
  if (isMid && body.cms_reference_number !== undefined) {
    finalCms = body.cms_reference_number;
  }

  const surveyRef = body.survey_reference_number !== undefined ? body.survey_reference_number : existing.survey_reference_number;
  const reqParty = body.survey_requested_by !== undefined ? body.survey_requested_by : existing.survey_requested_by;
  const dateSurvey = body.date_of_survey !== undefined ? body.date_of_survey : existing.date_of_survey;
  const coordinator = body.request_coordinator !== undefined ? body.request_coordinator : existing.request_coordinator;
  const surveyCost = body.survey_cost !== undefined ? Number(body.survey_cost) : existing.survey_cost;
  const incidentDesc = body.incident_description !== undefined ? body.incident_description : existing.incident_description;
  const dateIncident = body.date_of_incident !== undefined ? body.date_of_incident : existing.date_of_incident;
  const placeIncident = body.place_of_incident !== undefined ? body.place_of_incident : existing.place_of_incident;
  const cargoType = body.cargo_type !== undefined ? body.cargo_type : existing.cargo_type;
  const damageType = body.nature_of_damage_type !== undefined ? body.nature_of_damage_type : existing.nature_of_damage_type;
  const selectedContainers = body.selected_containers !== undefined ? JSON.stringify(body.selected_containers) : existing.selected_containers;
  const containersWithSizes = body.containers_with_sizes !== undefined ? JSON.stringify(body.containers_with_sizes) : existing.containers_with_sizes;
  const expenseTally = body.expense_tally_records !== undefined ? JSON.stringify(body.expense_tally_records) : existing.expense_tally_records;
  const recoveryTally = body.recovery_tally_records !== undefined ? JSON.stringify(body.recovery_tally_records) : existing.recovery_tally_records;
  const comments = body.comments !== undefined ? JSON.stringify(body.comments) : existing.comments;
  const attachments = body.attachments !== undefined ? JSON.stringify(body.attachments) : existing.attachments;

  await db.prepare(`
    UPDATE surveys SET
      survey_status = ?,
      cms_reference_number = ?,
      survey_reference_number = ?,
      survey_requested_by = ?,
      date_of_survey = ?,
      request_coordinator = ?,
      survey_cost = ?,
      incident_description = ?,
      date_of_incident = ?,
      place_of_incident = ?,
      cargo_type = ?,
      nature_of_damage_type = ?,
      selected_containers = ?,
      containers_with_sizes = ?,
      expense_tally_records = ?,
      recovery_tally_records = ?,
      comments = ?,
      attachments = ?,
      updated_date = ?
    WHERE id = ?
  `).run(
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
  );

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

export default router;
