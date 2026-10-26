import React from 'react';

interface SectionCardProps {
  title: string;
  icon?: React.ReactNode;
  rightElement?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  icon,
  rightElement,
  children,
  className = '',
}) => {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6 ${className}`}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-2.5">
          {icon && <div className="text-slate-600 flex-shrink-0">{icon}</div>}
          <h2 className="text-sm font-semibold tracking-wide text-slate-800 uppercase text-[12px]">{title}</h2>
        </div>
        {rightElement && <div>{rightElement}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
};
