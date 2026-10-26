import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Check, X } from 'lucide-react';
import { CURRENCIES, RECOVERY_LIABLE_PARTIES } from '../constants/referenceData';
import { api } from '../services/api';

export interface TallyRecord {
  id: string;
  date: string;
  expense_type?: string;
  recovery_type?: string;
  liable_party?: string;
  description: string;
  currency: string;
  amount: number;
  exchange_rate: number;
  amount_usd: number;
}

interface TallyTableProps {
  title: string;
  typeOptions: string[];
  records: TallyRecord[];
  isRecovery?: boolean;
  canEdit?: boolean;
  onChange: (records: TallyRecord[]) => void;
}

export const TallyTable: React.FC<TallyTableProps> = ({
  title,
  typeOptions,
  records = [],
  isRecovery = false,
  canEdit = true,
  onChange,
}) => {
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1.0 });
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<{
    date: string;
    itemType: string;
    liableParty: string;
    description: string;
    currency: string;
    amount: string;
  }>({
    date: new Date().toISOString().split('T')[0],
    itemType: typeOptions[0] || '',
    liableParty: isRecovery ? RECOVERY_LIABLE_PARTIES[0] : '',
    description: '',
    currency: 'USD',
    amount: '',
  });

  useEffect(() => {
    api.getRates()
      .then((data) => {
        if (data && data.rates) {
          setRates(data.rates);
        }
      })
      .catch((err) => {
        console.error('Failed to load rates in TallyTable:', err);
      });
  }, []);

  // Compute exchange rate and USD amount
  const getCalculation = (currency: string, rawAmount: number) => {
    const rate = rates[currency] || 1.0;
    let amountUsd = rawAmount;
    if (currency !== 'USD' && rate > 0) {
      amountUsd = rawAmount / rate;
    }
    return {
      exchange_rate: Math.round(rate * 10000) / 10000,
      amount_usd: Math.round(amountUsd * 100) / 100,
    };
  };

  const resetForm = () => {
    setFormData({
      date: new Date().toISOString().split('T')[0],
      itemType: typeOptions[0] || '',
      liableParty: isRecovery ? RECOVERY_LIABLE_PARTIES[0] : '',
      description: '',
      currency: 'USD',
      amount: '',
    });
    setIsAdding(false);
    setEditingId(null);
  };

  const handleSave = () => {
    const rawAmt = parseFloat(formData.amount);
    if (isNaN(rawAmt) || rawAmt <= 0) {
      alert('Please enter a valid amount greater than 0');
      return;
    }

    if (!formData.itemType) {
      alert('Please select a type');
      return;
    }

    if (isRecovery && formData.itemType === 'Recovery from Liable Party' && !formData.liableParty) {
      alert('Liable Party is required for Recovery from Liable Party');
      return;
    }

    const { exchange_rate, amount_usd } = getCalculation(formData.currency, rawAmt);

    if (editingId) {
      const updated = records.map((r) => {
        if (r.id === editingId) {
          return {
            ...r,
            date: formData.date,
            ...(isRecovery ? { recovery_type: formData.itemType } : { expense_type: formData.itemType }),
            liable_party: isRecovery && formData.itemType === 'Recovery from Liable Party' ? formData.liableParty : undefined,
            description: formData.description,
            currency: formData.currency,
            amount: rawAmt,
            exchange_rate,
            amount_usd,
          };
        }
        return r;
      });
      onChange(updated);
    } else {
      const newRec: TallyRecord = {
        id: `rec-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        date: formData.date,
        ...(isRecovery ? { recovery_type: formData.itemType } : { expense_type: formData.itemType }),
        liable_party: isRecovery && formData.itemType === 'Recovery from Liable Party' ? formData.liableParty : undefined,
        description: formData.description,
        currency: formData.currency,
        amount: rawAmt,
        exchange_rate,
        amount_usd,
      };
      onChange([...records, newRec]);
    }

    resetForm();
  };

  const handleEdit = (r: TallyRecord) => {
    setEditingId(r.id);
    setFormData({
      date: r.date || new Date().toISOString().split('T')[0],
      itemType: (isRecovery ? r.recovery_type : r.expense_type) || typeOptions[0],
      liableParty: r.liable_party || (isRecovery ? RECOVERY_LIABLE_PARTIES[0] : ''),
      description: r.description || '',
      currency: r.currency || 'USD',
      amount: String(r.amount || ''),
    });
    setIsAdding(true);
  };

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to remove this record?')) {
      onChange(records.filter((r) => r.id !== id));
    }
  };

  const totalUsd = records.reduce((sum, r) => sum + (Number(r.amount_usd) || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {title} ({records.length})
        </span>
        {canEdit && !isAdding && (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setIsAdding(true);
            }}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Record
          </button>
        )}
      </div>

      {/* Inline Form */}
      {isAdding && canEdit && (
        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3 text-sm">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <span className="font-semibold text-slate-800 text-xs uppercase tracking-wider">
              {editingId ? 'Edit Record' : 'New Record'}
            </span>
            <button
              type="button"
              onClick={resetForm}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">Date</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">Type</label>
              <select
                value={formData.itemType}
                onChange={(e) => setFormData({ ...formData, itemType: e.target.value })}
                className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs bg-white"
              >
                {typeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Conditional Liable Party for Recovery */}
            {isRecovery && formData.itemType === 'Recovery from Liable Party' && (
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">
                  Liable Party <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.liableParty}
                  onChange={(e) => setFormData({ ...formData, liableParty: e.target.value })}
                  className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs bg-white"
                >
                  {RECOVERY_LIABLE_PARTIES.map((lp) => (
                    <option key={lp} value={lp}>
                      {lp}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">Currency</label>
              <select
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs bg-white"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">Amount</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">
                Rate (USD) [Auto]
              </label>
              <input
                type="text"
                readOnly
                disabled
                value={rates[formData.currency] || 1.0}
                className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs bg-slate-100 text-slate-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">Description</label>
            <input
              type="text"
              placeholder="Record details..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs bg-white"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={resetForm}
              className="px-3 py-1 text-xs border border-slate-200 rounded text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1 px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              Save Record
            </button>
          </div>
        </div>
      )}

      {/* Records Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3">Date</th>
              <th className="py-2.5 px-3">Type</th>
              {isRecovery && <th className="py-2.5 px-3">Liable Party</th>}
              <th className="py-2.5 px-3">Description</th>
              <th className="py-2.5 px-3">Currency</th>
              <th className="py-2.5 px-3 text-right">Amount</th>
              <th className="py-2.5 px-3 text-right">Rate</th>
              <th className="py-2.5 px-3 text-right">USD Amount</th>
              {canEdit && <th className="py-2.5 px-3 text-center w-16">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {records.length === 0 ? (
              <tr>
                <td colSpan={isRecovery ? 9 : 8} className="py-4 text-center text-slate-400">
                  No records added yet.
                </td>
              </tr>
            ) : (
              records.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="py-2 px-3 text-slate-600">{r.date}</td>
                  <td className="py-2 px-3 font-medium text-slate-900">
                    {(isRecovery ? r.recovery_type : r.expense_type) || '—'}
                  </td>
                  {isRecovery && (
                    <td className="py-2 px-3 text-slate-600">{r.liable_party || '—'}</td>
                  )}
                  <td className="py-2 px-3 text-slate-600 max-w-xs truncate" title={r.description}>
                    {r.description || '—'}
                  </td>
                  <td className="py-2 px-3 text-slate-600 font-semibold">{r.currency}</td>
                  <td className="py-2 px-3 text-right font-medium">
                    {Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-500">
                    {r.exchange_rate ? Number(r.exchange_rate).toFixed(4) : '1.0000'}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold text-slate-900">
                    ${Number(r.amount_usd || r.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  {canEdit && (
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleEdit(r)}
                          className="text-slate-400 hover:text-blue-600 cursor-pointer p-0.5"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          className="text-slate-400 hover:text-rose-600 cursor-pointer p-0.5"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          {records.length > 0 && (
            <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
              <tr>
                <td colSpan={isRecovery ? 7 : 6} className="py-2 px-3 text-right text-slate-700">
                  Subtotal (USD):
                </td>
                <td className="py-2 px-3 text-right text-slate-900 font-bold">
                  ${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                {canEdit && <td></td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};
