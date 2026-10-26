import React from 'react';
import { StatusBadge } from './StatusBadge';
import { NetAmountSummary } from './NetAmountSummary';

interface ClaimReadOnlyViewProps {
  claim: any;
}

export const ClaimReadOnlyView: React.FC<ClaimReadOnlyViewProps> = ({ claim }) => {
  const expenseRecords = claim.expense_tally_records || [];
  const recoveryRecords = claim.recovery_tally_records || [];
  const containers = claim.containers_with_sizes || [];

  const totalExpenseUsd = expenseRecords.reduce((sum: number, r: any) => sum + (Number(r.amount_usd) || 0), 0);
  const totalRecoveryUsd = recoveryRecords.reduce((sum: number, r: any) => sum + (Number(r.amount_usd) || 0), 0);

  return (
    <div className="space-y-6 text-sm">
      {/* 1. Claim & Workflow Information */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2 mb-4">
          Claim & Workflow Information
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Claim Number</span>
            <span className="font-semibold text-slate-900">{claim.claim_number}</span>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">CMS Number</span>
            <span className="text-slate-800">{claim.cms_number || '—'}</span>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Status</span>
            <StatusBadge status={claim.status} type="claim" />
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">SLA Indicator</span>
            <StatusBadge status={claim.sla_status || 'green'} type="sla" />
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Claimant</span>
            <span className="font-medium text-slate-800">{claim.claimant || '—'}</span>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Claimant Type</span>
            <span className="text-slate-800">{claim.claimant_type || '—'}</span>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Claim Amount</span>
            <span className="font-bold text-blue-600">
              {claim.claim_amount !== null && claim.claim_amount !== undefined
                ? `$${Number(claim.claim_amount).toLocaleString()}`
                : 'Not specified'}
            </span>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Claims Handler</span>
            <span className="text-slate-800">{claim.claims_handler || 'Unassigned'}</span>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Time Bar Date</span>
            <span className="text-slate-800">
              {claim.time_bar_date ? new Date(claim.time_bar_date).toLocaleDateString() : '—'}
            </span>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Survey Status</span>
            <StatusBadge status={claim.survey_status || 'none'} type="survey" />
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Created Date</span>
            <span className="text-slate-800">{new Date(claim.created_date).toLocaleString()}</span>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 block">Last Action Date</span>
            <span className="text-slate-800">
              {claim.last_action_date ? new Date(claim.last_action_date).toLocaleString() : '—'}
            </span>
          </div>
        </div>

        {/* Conditional Court Case in Read-Only */}
        {claim.status === 'awaiting_input' && claim.awaiting_input_reason === 'court_case' && (
          <div className="mt-4 p-4 bg-amber-50/50 rounded-lg border border-amber-200">
            <h4 className="text-xs font-semibold text-amber-900 uppercase tracking-wider mb-2">
              Court Case Details
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-slate-500 block">Status:</span>
                <span className="font-medium text-slate-800">{claim.court_case_status || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">File Ref:</span>
                <span className="font-medium text-slate-800">{claim.court_case_file_reference || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Location:</span>
                <span className="font-medium text-slate-800">{claim.court_case_location || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Chance:</span>
                <span className="font-medium text-slate-800">{claim.court_case_chance_of_winning || '—'}</span>
              </div>
              {claim.court_case_attachment_comment && (
                <div className="col-span-2 md:col-span-4 mt-2">
                  <span className="text-slate-500 block">Remarks:</span>
                  <p className="text-slate-800">{claim.court_case_attachment_comment}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. Shipment & LMS Information */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2 mb-4">
          Shipment & LMS Information
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">BL Number</span>
            <span className="font-semibold text-slate-900 font-mono">{claim.bl_number}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Shipper</span>
            <span className="text-slate-800">{claim.shipper || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Consignee</span>
            <span className="text-slate-800">{claim.consignee || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Notify Party</span>
            <span className="text-slate-800">{claim.notify_party || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Vessel & Voyage</span>
            <span className="text-slate-800">{claim.vessel_name} ({claim.vessel_voyage})</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Port of Loading</span>
            <span className="text-slate-800">{claim.port_of_loading || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Port of Discharge</span>
            <span className="text-slate-800">{claim.port_of_discharge || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Commodity</span>
            <span className="text-slate-800">{claim.commodity || '—'}</span>
          </div>
        </div>
      </div>

      {/* 3. Containers Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2 mb-3">
          Containers Involved ({containers.length})
        </h3>
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 uppercase text-[10px] font-semibold text-slate-500 border-b">
              <tr>
                <th className="p-2">Container Number</th>
                <th className="p-2">Seal Number</th>
                <th className="p-2">Size</th>
                <th className="p-2">Measure</th>
                <th className="p-2">Weight</th>
                <th className="p-2">Package Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {containers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-3 text-center text-slate-400">No containers recorded.</td>
                </tr>
              ) : (
                containers.map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="p-2 font-medium text-slate-900">{c.container_number}</td>
                    <td className="p-2">{c.seal_number || '—'}</td>
                    <td className="p-2">{c.container_size || '—'}</td>
                    <td className="p-2">{c.measure || '—'}</td>
                    <td className="p-2">{c.weight ? `${c.weight} kg` : '—'}</td>
                    <td className="p-2">{c.package_type || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Incident Information */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2 mb-3">
          Incident Information
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs mb-3">
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Date of Incident</span>
            <span className="text-slate-800">{claim.date_of_incident || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Place of Incident</span>
            <span className="text-slate-800">{claim.place_of_incident || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Cargo Type</span>
            <span className="text-slate-800 uppercase font-semibold">{claim.cargo_type || 'Dry'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Nature of Damage</span>
            <span className="text-slate-800">{claim.nature_of_damage_type || '—'}</span>
          </div>
        </div>
        <div>
          <span className="text-slate-400 uppercase text-[10px] block mb-1">Description</span>
          <p className="p-3 bg-slate-50 rounded border border-slate-200 text-xs text-slate-800 whitespace-pre-wrap">
            {claim.incident_description || 'No description provided.'}
          </p>
        </div>
      </div>

      {/* 5. Policy Information */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b border-slate-100 pb-2 mb-3">
          Policy Information & Affiliated Claims
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Policy Deductible Type</span>
            <span className="text-slate-800">{claim.policy_deductible_type || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">P&I Club</span>
            <span className="text-slate-800">{claim.policy_pi_club || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Policy Number</span>
            <span className="text-slate-800">{claim.policy_number || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Deductible USD</span>
            <span className="text-slate-800">
              {claim.policy_deductible_usd ? `$${Number(claim.policy_deductible_usd).toLocaleString()}` : '—'}
            </span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Affiliated Claim</span>
            <span className="text-slate-800">{claim.affiliated_claim_number || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 uppercase text-[10px] block">Reference Number</span>
            <span className="text-slate-800">{claim.reference_number || '—'}</span>
          </div>
        </div>
      </div>

      {/* 6. Expenses & Recovery Summary */}
      <NetAmountSummary totalExpensesUsd={totalExpenseUsd} totalRecoveryUsd={totalRecoveryUsd} />
    </div>
  );
};
