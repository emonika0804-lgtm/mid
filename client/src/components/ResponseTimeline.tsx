import React, { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export interface ResponseHistoryItem {
  action: 'open' | 'close';
  user: string;
  timestamp: string;
  remarks: string;
}

interface ResponseTimelineProps {
  history: ResponseHistoryItem[];
  canEdit?: boolean;
  onAddResponse: (item: ResponseHistoryItem) => void;
}

export const ResponseTimeline: React.FC<ResponseTimelineProps> = ({
  history = [],
  canEdit = true,
  onAddResponse,
}) => {
  const { user } = useAuth();
  const [remarks, setRemarks] = useState('');

  // Rule 24: Last action determines next (if last=open, next=close; vice versa)
  const lastAction = history.length > 0 ? history[history.length - 1].action : 'close';
  const nextAction: 'open' | 'close' = lastAction === 'open' ? 'close' : 'open';

  const handleToggle = () => {
    if (!remarks.trim()) {
      alert('Please enter remarks for this response status change.');
      return;
    }

    const newItem: ResponseHistoryItem = {
      action: nextAction,
      user: user?.full_name || 'User',
      timestamp: new Date().toISOString(),
      remarks: remarks.trim(),
    };

    onAddResponse(newItem);
    setRemarks('');
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <span className="font-semibold uppercase tracking-wider text-slate-700 text-[11px]">
          Response Received Tracker
        </span>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
            lastAction === 'open'
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          {lastAction === 'open' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
          Status: {lastAction.toUpperCase()}
        </span>
      </div>

      {/* Action Input Form */}
      {canEdit && (
        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
          <label className="block text-[10px] font-semibold uppercase text-slate-600">
            Next Action: Mark as <strong className="text-blue-600 uppercase">{nextAction}</strong>
          </label>
          <input
            type="text"
            placeholder="Add remarks (e.g. Received surveyor report, follow-up required)..."
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="w-full bg-white rounded border border-slate-200 px-2.5 py-1.5 text-xs"
          />
          <button
            type="button"
            onClick={handleToggle}
            className={`w-full py-1.5 px-3 rounded font-medium text-white cursor-pointer transition-colors ${
              nextAction === 'open'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-rose-600 hover:bg-rose-700'
            }`}
          >
            Submit Response as {nextAction.toUpperCase()}
          </button>
        </div>
      )}

      {/* History Timeline */}
      <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
        {history.length === 0 ? (
          <p className="text-center text-slate-400 py-3">No response history logged.</p>
        ) : (
          history.slice().reverse().map((item, idx) => (
            <div key={idx} className="flex items-start gap-2 p-2 bg-white rounded border border-slate-100">
              <div className="mt-0.5">
                {item.action === 'open' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-500" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
                  <span className="font-semibold text-slate-700">{item.user}</span>
                  <span>{new Date(item.timestamp).toLocaleDateString()}</span>
                </div>
                <p className="text-slate-800 text-[11px] leading-snug">{item.remarks}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
