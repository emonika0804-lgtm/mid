import React from 'react';
import { WORKFLOW_STATUS_ORDER, AWAITING_INPUT_REASONS, CLOSED_REASONS } from '../constants/referenceData';
import { StatusBadge } from './StatusBadge';

interface WorkflowControlProps {
  status: string;
  awaitingInputReason: string;
  closedReason: string;
  canEdit: boolean;
  onChange: (updates: { status?: string; awaiting_input_reason?: string; closed_reason?: string }) => void;
}

export const WorkflowControl: React.FC<WorkflowControlProps> = ({
  status,
  awaitingInputReason,
  closedReason,
  canEdit,
  onChange,
}) => {
  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current Status</span>
        <StatusBadge status={status} type="claim" />
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">
          Change Status {!canEdit && <span className="text-[10px] text-slate-400 font-normal">(MID only)</span>}
        </label>
        <select
          disabled={!canEdit}
          value={status || 'new_claim'}
          onChange={(e) => {
            const nextStatus = e.target.value;
            onChange({
              status: nextStatus,
              awaiting_input_reason: nextStatus === 'awaiting_input' ? (awaitingInputReason || 'customer') : '',
              closed_reason: nextStatus === 'closed' ? (closedReason || 'settled') : '',
            });
          }}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
        >
          {WORKFLOW_STATUS_ORDER.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {/* Conditional: Awaiting Input Reason */}
      {status === 'awaiting_input' && (
        <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-200">
          <label className="block text-[11px] font-semibold uppercase text-amber-900 mb-1">
            Awaiting Input Reason <span className="text-rose-500">*</span>
          </label>
          <select
            disabled={!canEdit}
            value={awaitingInputReason || ''}
            onChange={(e) => onChange({ awaiting_input_reason: e.target.value })}
            className="w-full rounded border border-amber-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-slate-50"
          >
            <option value="">Select reason...</option>
            {AWAITING_INPUT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Conditional: Closed Reason */}
      {status === 'closed' && (
        <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-200">
          <label className="block text-[11px] font-semibold uppercase text-emerald-900 mb-1">
            Closed Reason <span className="text-rose-500">*</span>
          </label>
          <select
            disabled={!canEdit}
            value={closedReason || ''}
            onChange={(e) => onChange({ closed_reason: e.target.value })}
            className="w-full rounded border border-emerald-300 px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-50"
          >
            <option value="">Select resolution...</option>
            {CLOSED_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};
