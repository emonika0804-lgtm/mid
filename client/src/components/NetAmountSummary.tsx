import React from 'react';
import { ArrowDownRight, ArrowUpRight, Scale } from 'lucide-react';

interface NetAmountSummaryProps {
  totalExpensesUsd: number;
  totalRecoveryUsd: number;
}

export const NetAmountSummary: React.FC<NetAmountSummaryProps> = ({
  totalExpensesUsd,
  totalRecoveryUsd,
}) => {
  const netAmount = totalExpensesUsd - totalRecoveryUsd;
  const isNetPositive = netAmount >= 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-4">
      {/* Total Expenses */}
      <div className="bg-rose-50/50 border border-rose-200 rounded-xl p-4 flex items-center justify-between">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-rose-600 block mb-0.5">
            Total Expenses
          </span>
          <span className="text-xl font-bold text-rose-700">
            ${totalExpensesUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] text-rose-500 block mt-0.5">USD equivalent</span>
        </div>
        <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
          <ArrowDownRight className="w-5 h-5" />
        </div>
      </div>

      {/* Total Recovery */}
      <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600 block mb-0.5">
            Total Recovery
          </span>
          <span className="text-xl font-bold text-emerald-700">
            ${totalRecoveryUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] text-emerald-500 block mt-0.5">USD equivalent</span>
        </div>
        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
          <ArrowUpRight className="w-5 h-5" />
        </div>
      </div>

      {/* Net Amount */}
      <div
        className={`border rounded-xl p-4 flex items-center justify-between ${
          isNetPositive
            ? 'bg-blue-50/50 border-blue-200 text-blue-700'
            : 'bg-rose-50/50 border-rose-200 text-rose-700'
        }`}
      >
        <div>
          <span
            className={`text-[11px] font-semibold uppercase tracking-wider block mb-0.5 ${
              isNetPositive ? 'text-blue-600' : 'text-rose-600'
            }`}
          >
            Net Amount
          </span>
          <span className={`text-xl font-bold ${isNetPositive ? 'text-blue-700' : 'text-rose-700'}`}>
            ${Math.abs(netAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[10px] opacity-75 block mt-0.5">
            {netAmount < 0 ? 'Net Recovery Excess (USD)' : 'Net PIL Exposure (USD)'}
          </span>
        </div>
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center ${
            isNetPositive ? 'bg-blue-100 text-blue-600' : 'bg-rose-100 text-rose-600'
          }`}
        >
          <Scale className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};
