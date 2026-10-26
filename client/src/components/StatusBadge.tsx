import React from 'react';

interface StatusBadgeProps {
  status: string;
  type?: 'claim' | 'survey' | 'sla' | 'role';
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, type = 'claim', className = '' }) => {
  const getBadgeStyle = () => {
    const s = (status || '').toLowerCase();

    if (type === 'sla') {
      if (s === 'green') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      if (s === 'amber') return 'bg-amber-50 text-amber-700 border-amber-200';
      if (s === 'red') return 'bg-rose-50 text-rose-700 border-rose-200';
      return 'bg-slate-50 text-slate-700 border-slate-200';
    }

    if (type === 'role') {
      if (s === 'admin') return 'bg-purple-50 text-purple-700 border-purple-200 font-semibold';
      if (s === 'mid' || s === 'mid_gcc') return 'bg-blue-50 text-blue-700 border-blue-200 font-medium';
      return 'bg-slate-100 text-slate-700 border-slate-200';
    }

    if (type === 'survey') {
      switch (s) {
        case 'new_survey':
          return 'bg-slate-100 text-slate-700 border-slate-200';
        case 'appointed':
        case 'accepted':
          return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        case 'pending':
          return 'bg-amber-50 text-amber-700 border-amber-200';
        case 'rejected':
          return 'bg-rose-50 text-rose-700 border-rose-200';
        default:
          return 'bg-slate-100 text-slate-700 border-slate-200';
      }
    }

    // Default Claim statuses
    switch (s) {
      case 'new_claim':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'pre_claim':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'in_progress':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'awaiting_input':
        return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'awaiting_approval':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'closed':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getLabel = () => {
    const s = status || '';
    if (type === 'role') {
      if (s === 'mid_gcc') return 'MID (GCC)';
      if (s === 'mid') return 'MID';
      if (s === 'admin') return 'Admin';
      if (s === 'agency') return 'Agency';
    }
    return s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getBadgeStyle()} ${className}`}
    >
      {getLabel()}
    </span>
  );
};
