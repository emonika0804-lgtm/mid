import React from 'react';

interface AffiliatedClaimNumberProps {
  affiliatedClaimNumber?: string;
  referenceNumber?: string;
  canEdit?: boolean;
  onChange: (fields: { affiliated_claim_number?: string; reference_number?: string }) => void;
}

export const AffiliatedClaimNumber: React.FC<AffiliatedClaimNumberProps> = ({
  affiliatedClaimNumber = '',
  referenceNumber = '',
  canEdit = true,
  onChange,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Affiliated Claim Number
        </label>
        <input
          type="text"
          disabled={!canEdit}
          placeholder="e.g. CLM-2025-0811"
          value={affiliatedClaimNumber || ''}
          onChange={(e) => onChange({ affiliated_claim_number: e.target.value })}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50 disabled:text-slate-500"
        />
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
          Reference Number
        </label>
        <input
          type="text"
          disabled={!canEdit}
          placeholder="e.g. EXT-REF-4412"
          value={referenceNumber || ''}
          onChange={(e) => onChange({ reference_number: e.target.value })}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50 disabled:text-slate-500"
        />
      </div>
    </div>
  );
};
