import React from 'react';
import { History, ArrowRight } from 'lucide-react';

export interface AuditLogItem {
  id: string;
  action: string;
  performed_by_name?: string;
  created_date: string;
  field_changed?: string;
  old_value?: string;
  new_value?: string;
  details?: string;
  remarks?: string;
}

interface AuditLogPanelProps {
  logs: AuditLogItem[];
}

export const AuditLogPanel: React.FC<AuditLogPanelProps> = ({ logs = [] }) => {
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <span className="font-semibold uppercase tracking-wider text-slate-700 text-[11px] flex items-center gap-1.5">
          <History className="w-3.5 h-3.5 text-slate-500" />
          Audit Trail ({logs.length})
        </span>
      </div>

      <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
        {logs.length === 0 ? (
          <p className="text-center text-slate-400 py-4">No audit logs recorded yet.</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-500">
                <span className="font-semibold text-slate-700">
                  {log.performed_by_name || 'System User'}
                </span>
                <span>{new Date(log.created_date).toLocaleString()}</span>
              </div>

              <div className="flex items-center gap-1.5 font-medium text-slate-800 text-[11px]">
                <span className="px-1.5 py-0.2 bg-slate-200 rounded text-[9px] uppercase font-bold tracking-wider">
                  {log.action}
                </span>
                <span>{log.details || 'Change logged'}</span>
              </div>

              {log.field_changed && (
                <div className="mt-1 flex items-center gap-1.5 text-[10px] bg-white p-1 rounded border border-slate-100 text-slate-600">
                  <span className="font-semibold text-slate-500">{log.field_changed}:</span>
                  <span className="line-through text-rose-500 max-w-[100px] truncate">{log.old_value || 'empty'}</span>
                  <ArrowRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
                  <span className="text-emerald-600 font-medium max-w-[100px] truncate">{log.new_value || 'empty'}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
