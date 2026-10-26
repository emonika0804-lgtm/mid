import { Router, Response } from 'express';
import { AuthenticatedRequest, authenticate, requireRole } from '../auth';
import db from '../db';

const router = Router();

function parseJSONSafely(str: any, fallback: any = []) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

router.get('/metrics', authenticate, requireRole(['mid', 'mid_gcc', 'admin']), async (req: AuthenticatedRequest, res: Response) => {
  // 1. Fetch claims
  const claims = (await db.prepare('SELECT * FROM claims').all()) as any[];

  let totalClaims = claims.length;
  let openClaims = 0;
  let closedClaims = 0;
  let pendingClaims = 0;

  const claimStatusCounts: Record<string, number> = {
    new_claim: 0,
    pre_claim: 0,
    in_progress: 0,
    awaiting_input: 0,
    awaiting_approval: 0,
    closed: 0,
  };

  const awaitingInputBreakdown: Record<string, number> = {
    customer: 0,
    claimant: 0,
    internal: 0,
    pi: 0,
    court_case: 0,
  };

  const closedBreakdown: Record<string, number> = {
    settled: 0,
    rejected: 0,
  };

  for (const c of claims) {
    if (c.status === 'closed') {
      closedClaims++;
      if (c.closed_reason && closedBreakdown[c.closed_reason] !== undefined) {
        closedBreakdown[c.closed_reason]++;
      }
    } else {
      openClaims++;
      if (['new_claim', 'pre_claim', 'awaiting_approval', 'awaiting_input'].includes(c.status)) {
        pendingClaims++;
      }
    }

    if (claimStatusCounts[c.status] !== undefined) {
      claimStatusCounts[c.status]++;
    }

    if (c.status === 'awaiting_input' && c.awaiting_input_reason && awaitingInputBreakdown[c.awaiting_input_reason] !== undefined) {
      awaitingInputBreakdown[c.awaiting_input_reason]++;
    }
  }

  // 2. Fetch surveys
  const surveys = (await db.prepare('SELECT * FROM surveys').all()) as any[];
  const surveyStatusCounts: Record<string, number> = {
    new_survey: 0,
    appointed: 0,
    pending: 0,
    rejected: 0,
    converted: 0,
  };

  for (const s of surveys) {
    if (s.converted_to_claim_id) {
      surveyStatusCounts.converted++;
    }
    if (s.survey_status === 'appointed' || s.survey_status === 'accepted') {
      surveyStatusCounts.appointed++;
    } else if (surveyStatusCounts[s.survey_status] !== undefined) {
      surveyStatusCounts[s.survey_status]++;
    }
  }

  // 3. Standalone + Embedded Expenses
  const standaloneExpenses = (await db.prepare('SELECT * FROM expenses').all()) as any[];
  const mergedExpenses: any[] = [...standaloneExpenses];

  for (const c of claims) {
    const tally = parseJSONSafely(c.expense_tally_records, []);
    for (const exp of tally) {
      mergedExpenses.push({
        id: exp.id || `clm-exp-${c.id}-${Math.random()}`,
        claim_id: c.id,
        claim_number: c.claim_number,
        bl_number: c.bl_number,
        expense_type: exp.expense_type,
        amount: exp.amount_usd || exp.amount || 0,
        currency: 'USD',
        status: 'settled',
        settlement_amount: exp.amount_usd || exp.amount || 0,
        description: exp.description,
        created_date: exp.date || c.created_date,
      });
    }
  }

  let totalExpensesUsd = 0;
  let settledExpensesUsd = 0;
  const expensesByTypeMap: Record<string, number> = {};

  for (const exp of mergedExpenses) {
    const amt = Number(exp.amount) || 0;
    const settAmt = Number(exp.settlement_amount) || 0;
    totalExpensesUsd += amt;
    settledExpensesUsd += settAmt;

    const type = exp.expense_type || 'Others';
    expensesByTypeMap[type] = (expensesByTypeMap[type] || 0) + amt;
  }

  const outstandingExpensesUsd = Math.max(0, totalExpensesUsd - settledExpensesUsd);

  // 4. Standalone + Embedded Recoveries
  const standaloneRecoveries = (await db.prepare('SELECT * FROM recoveries').all()) as any[];
  const mergedRecoveries: any[] = [...standaloneRecoveries];

  for (const c of claims) {
    const tally = parseJSONSafely(c.recovery_tally_records, []);
    for (const rec of tally) {
      mergedRecoveries.push({
        id: rec.id || `clm-rec-${c.id}-${Math.random()}`,
        claim_id: c.id,
        claim_number: c.claim_number,
        bl_number: c.bl_number,
        recovery_status: 'recovered',
        recovery_amount: rec.amount_usd || rec.amount || 0,
        recovered_amount: rec.amount_usd || rec.amount || 0,
        outstanding_recovery: 0,
        recovery_source: rec.recovery_type,
        liable_party: rec.liable_party || 'Carrier (PIL)',
        remarks: rec.description,
        date: rec.date || c.created_date,
        created_date: rec.date || c.created_date,
      });
    }
  }

  let totalRecoveryUsd = 0;
  let recoveredUsd = 0;
  const recoveryByLiableMap: Record<string, number> = {};

  for (const rec of mergedRecoveries) {
    const amt = Number(rec.recovery_amount) || 0;
    const recAmt = Number(rec.recovered_amount) || 0;
    totalRecoveryUsd += amt;
    recoveredUsd += recAmt;

    const party = rec.liable_party || 'Others';
    recoveryByLiableMap[party] = (recoveryByLiableMap[party] || 0) + amt;
  }

  const outstandingRecoveryUsd = Math.max(0, totalRecoveryUsd - recoveredUsd);

  return res.json({
    claims: {
      total: totalClaims,
      open: openClaims,
      closed: closedClaims,
      pending: pendingClaims,
      by_status: claimStatusCounts,
      awaiting_input_breakdown: awaitingInputBreakdown,
      closed_breakdown: closedBreakdown,
      chart_data: [
        { status: 'New Claim', key: 'new_claim', count: claimStatusCounts.new_claim, color: '#64748b' },
        { status: 'Pre-Claim', key: 'pre_claim', count: claimStatusCounts.pre_claim, color: '#6366f1' },
        { status: 'In Progress', key: 'in_progress', count: claimStatusCounts.in_progress, color: '#3b82f6' },
        { status: 'Awaiting Input', key: 'awaiting_input', count: claimStatusCounts.awaiting_input, color: '#f97316' },
        { status: 'Awaiting Approval', key: 'awaiting_approval', count: claimStatusCounts.awaiting_approval, color: '#f59e0b' },
        { status: 'Closed', key: 'closed', count: claimStatusCounts.closed, color: '#10b981' },
      ],
      list: claims.map(c => ({
        id: c.id,
        claim_number: c.claim_number,
        cms_number: c.cms_number,
        bl_number: c.bl_number,
        claimant: c.claimant,
        status: c.status,
        awaiting_input_reason: c.awaiting_input_reason,
        closed_reason: c.closed_reason,
        claim_amount: c.claim_amount,
        claims_handler: c.claims_handler,
        created_date: c.created_date,
      })),
    },
    surveys: {
      total: surveys.length,
      by_status: surveyStatusCounts,
      chart_data: [
        { status: 'New Survey', key: 'new_survey', count: surveyStatusCounts.new_survey, color: '#64748b' },
        { status: 'Appointed', key: 'appointed', count: surveyStatusCounts.appointed, color: '#10b981' },
        { status: 'Pending', key: 'pending', count: surveyStatusCounts.pending, color: '#f59e0b' },
        { status: 'Rejected', key: 'rejected', count: surveyStatusCounts.rejected, color: '#f43f5e' },
      ],
      list: surveys.map(s => ({
        id: s.id,
        survey_number: s.survey_number,
        bl_number: s.bl_number,
        survey_reference_number: s.survey_reference_number,
        survey_requested_by: s.survey_requested_by,
        survey_status: s.survey_status,
        converted_to_claim_id: s.converted_to_claim_id,
        converted_to_claim_number: s.converted_to_claim_number,
        survey_cost: s.survey_cost,
        created_date: s.created_date,
      })),
    },
    expenses: {
      total: totalExpensesUsd,
      settled: settledExpensesUsd,
      outstanding: outstandingExpensesUsd,
      count: mergedExpenses.length,
      chart_data: Object.entries(expensesByTypeMap).map(([type, amount]) => ({
        type,
        amount: Math.round(amount * 100) / 100,
      })).sort((a, b) => b.amount - a.amount),
      list: mergedExpenses,
    },
    recoveries: {
      total: totalRecoveryUsd,
      recovered: recoveredUsd,
      outstanding: outstandingRecoveryUsd,
      count: mergedRecoveries.length,
      chart_data: Object.entries(recoveryByLiableMap).map(([party, amount]) => ({
        party,
        amount: Math.round(amount * 100) / 100,
      })).sort((a, b) => b.amount - a.amount),
      list: mergedRecoveries,
    },
  });
});

export default router;
