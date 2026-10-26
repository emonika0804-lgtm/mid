import React from 'react';
import { POLICY_DEDUCTIBLE_TYPES } from '../constants/referenceData';

interface PolicyInformationProps {
  deductibleType?: string;
  piClub?: string;
  policyNumber?: string;
  deductibleUsd?: number | null;
  canEdit?: boolean;
  onChange: (fields: {
    policy_deductible_type?: string;
    policy_pi_club?: string;
    policy_number?: string;
    policy_deductible_usd?: number | null;
  }) => void;
}

export const PolicyInformation: React.FC<PolicyInformationProps> = ({
  deductibleType = '',
  piClub = '',
  policyNumber = '',
  deductibleUsd = null,
  canEdit = true,
  onChange,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Policy Deductible Type
        </label>
        <select
          disabled={!canEdit}
          value={deductibleType || ''}
          onChange={(e) => onChange({ policy_deductible_type: e.target.value })}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 bg-white text-xs disabled:bg-slate-50 disabled:text-slate-500"
        >
          <option value="">Select deductible type...</option>
          {POLICY_DEDUCTIBLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          P&I Club
        </label>
        <input
          type="text"
          disabled={!canEdit}
          placeholder="e.g. Standard Club / Britannia"
          value={piClub || ''}
          onChange={(e) => onChange({ policy_pi_club: e.target.value })}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50 disabled:text-slate-500"
        />
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Policy Number
        </label>
        <input
          type="text"
          disabled={!canEdit}
          placeholder="e.g. POL-2026-9921"
          value={policyNumber || ''}
          onChange={(e) => onChange({ policy_number: e.target.value })}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50 disabled:text-slate-500"
        />
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Policy Deductible (USD)
        </label>
        <input
          type="number"
          step="0.01"
          disabled={!canEdit}
          placeholder="0.00"
          value={deductibleUsd !== null && deductibleUsd !== undefined ? deductibleUsd : ''}
          onChange={(e) =>
            onChange({
              policy_deductible_usd: e.target.value === '' ? null : parseFloat(e.target.value),
            })
          }
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50 disabled:text-slate-500"
        />
      </div>
    </div>
  );
};
