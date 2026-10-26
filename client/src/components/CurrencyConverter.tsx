import React, { useState, useEffect } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { CURRENCIES } from '../constants/referenceData';
import { api } from '../services/api';

interface CurrencyConverterProps {
  initialAmount?: number;
}

export const CurrencyConverter: React.FC<CurrencyConverterProps> = ({ initialAmount = 1000 }) => {
  const [fromCurrency, setFromCurrency] = useState('USD');
  const [toCurrency, setToCurrency] = useState('SGD');
  const [amount, setAmount] = useState<number | string>(initialAmount || 1000);
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1.0 });
  const [rateDate, setRateDate] = useState<string>('');
  const [rateSource, setRateSource] = useState<string>('');

  useEffect(() => {
    api.getRates().then((data) => {
      if (data && data.rates) {
        setRates(data.rates);
        setRateDate(data.date || '');
        setRateSource(data.source || '');
      }
    });
  }, []);

  useEffect(() => {
    if (initialAmount && initialAmount > 0) {
      setAmount(initialAmount);
    }
  }, [initialAmount]);

  // Calculate conversion:
  // rates are USD-based: 1 USD = rates[CURR]
  // 1 FROM in USD = 1 / rates[FROM]
  // 1 FROM in TO = (1 / rates[FROM]) * rates[TO] = rates[TO] / rates[FROM]
  const fromRate = rates[fromCurrency] || 1.0;
  const toRate = rates[toCurrency] || 1.0;
  const crossRate = fromRate > 0 ? toRate / fromRate : 1.0;

  const numAmount = parseFloat(String(amount)) || 0;
  const convertedAmount = numAmount * crossRate;

  const swapCurrencies = () => {
    setFromCurrency(toCurrency);
    setToCurrency(fromCurrency);
  };

  return (
    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3 text-xs">
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <span className="font-semibold uppercase tracking-wider text-slate-700">Currency Converter</span>
        <span className="text-[10px] text-slate-400">
          Source: <span className="font-medium text-slate-600">{rateSource || 'Frankfurter API'}</span> ({rateDate || 'Today'})
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        <div>
          <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-white rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">From</label>
            <select
              value={fromCurrency}
              onChange={(e) => setFromCurrency(e.target.value)}
              className="w-full bg-white rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-800"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={swapCurrencies}
            title="Swap currencies"
            className="mt-4 p-1.5 rounded bg-slate-200 text-slate-600 hover:bg-slate-300 cursor-pointer"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex-1">
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">To</label>
            <select
              value={toCurrency}
              onChange={(e) => setToCurrency(e.target.value)}
              className="w-full bg-white rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-800"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-200/80 bg-white p-3 rounded border">
          <div className="text-[11px] text-slate-500 mb-0.5">
            1 {fromCurrency} = {crossRate.toFixed(4)} {toCurrency}
          </div>
          <div className="text-base font-bold text-slate-900">
            {convertedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
            <span className="text-xs font-semibold text-blue-600">{toCurrency}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
