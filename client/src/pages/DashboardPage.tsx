import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from 'recharts';
import {
  ShieldAlert,
  Loader2,
  X,
  ArrowRight,
  TrendingUp,
  DollarSign,
  FileText,
  ClipboardList,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [metrics, setMetrics] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtered table state
  const [filterContext, setFilterContext] = useState<{
    section: 'claims' | 'surveys' | 'expenses' | 'recoveries';
    title: string;
    items: any[];
  } | null>(null);

  const isMid = ['mid', 'mid_gcc', 'admin'].includes(user?.role || '');

  useEffect(() => {
    if (!isMid) {
      setIsLoading(false);
      return;
    }

    api.getDashboardMetrics()
      .then((data) => {
        setMetrics(data);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load dashboard metrics');
      })
      .finally(() => setIsLoading(false));
  }, [isMid]);

  // Section 10 & 13: MID-only access
  if (!isMid) {
    return (
      <div className="min-h-[500px] flex flex-col items-center justify-center text-center p-6">
        <div className="w-14 h-14 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Access Denied</h2>
        <p className="text-sm text-slate-500 max-w-md mt-1 mb-6">
          The Executive Claims & Survey Analytics Dashboard is restricted to Marine Insurance Department (MID) and Administrator accounts.
        </p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 cursor-pointer"
        >
          Return to Queues
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-96 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Aggregating Platform Analytics...
        </span>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="p-6 bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-sm">
        {error || 'Dashboard metrics could not be rendered.'}
      </div>
    );
  }

  const { claims, surveys, expenses, recoveries } = metrics;

  return (
    <div className="space-y-8">
      {/* Title */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Executive Dashboard</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Real-time visibility into claims processing, surveyor assignments, and financial recovery exposures.
        </p>
      </div>

      {/* 1. CLAIMS SECTION */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-blue-600" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800">
            Claims Overview & Workflow Status
          </h2>
        </div>

        {/* Primary KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div
            onClick={() =>
              setFilterContext({
                section: 'claims',
                title: 'All Claims',
                items: claims.list,
              })
            }
            className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-blue-400 transition-all cursor-pointer"
          >
            <span className="text-[10px] uppercase font-bold text-slate-400">Total Claims</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{claims.total}</div>
            <span className="text-[10px] text-blue-600 font-medium">Click to view all</span>
          </div>

          <div
            onClick={() =>
              setFilterContext({
                section: 'claims',
                title: 'Open Claims',
                items: claims.list.filter((c: any) => c.status !== 'closed'),
              })
            }
            className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-blue-400 transition-all cursor-pointer"
          >
            <span className="text-[10px] uppercase font-bold text-blue-600">Open Claims</span>
            <div className="text-2xl font-black text-blue-700 mt-1">{claims.open}</div>
            <span className="text-[10px] text-slate-400">Active processing</span>
          </div>

          <div
            onClick={() =>
              setFilterContext({
                section: 'claims',
                title: 'Pending Claims',
                items: claims.list.filter((c: any) =>
                  ['new_claim', 'pre_claim', 'awaiting_approval', 'awaiting_input'].includes(c.status)
                ),
              })
            }
            className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-amber-400 transition-all cursor-pointer"
          >
            <span className="text-[10px] uppercase font-bold text-amber-600">Pending Actions</span>
            <div className="text-2xl font-black text-amber-700 mt-1">{claims.pending}</div>
            <span className="text-[10px] text-slate-400">Awaiting input/approval</span>
          </div>

          <div
            onClick={() =>
              setFilterContext({
                section: 'claims',
                title: 'Closed Claims',
                items: claims.list.filter((c: any) => c.status === 'closed'),
              })
            }
            className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-emerald-400 transition-all cursor-pointer"
          >
            <span className="text-[10px] uppercase font-bold text-emerald-600">Closed Claims</span>
            <div className="text-2xl font-black text-emerald-700 mt-1">{claims.closed}</div>
            <span className="text-[10px] text-slate-400">Settled or Rejected</span>
          </div>
        </div>

        {/* Per-Status & Breakdown Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
          {claims.chart_data.map((item: any) => (
            <div
              key={item.key}
              onClick={() =>
                setFilterContext({
                  section: 'claims',
                  title: `Claims: ${item.status}`,
                  items: claims.list.filter((c: any) => c.status === item.key),
                })
              }
              className="p-3 bg-white rounded-lg border border-slate-200 hover:border-blue-400 transition-all cursor-pointer"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-[10px] uppercase font-semibold text-slate-500 truncate">
                  {item.status}
                </span>
              </div>
              <div className="text-lg font-bold text-slate-900">{item.count}</div>
            </div>
          ))}
        </div>

        {/* Bar Chart: Claims by Status */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 mb-4">
            Claims Distribution by Workflow Status
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={claims.chart_data} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {claims.chart_data.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 2. SURVEYS SECTION */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-emerald-600" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800">
            Surveys & Surveyor Operations
          </h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          <div
            onClick={() =>
              setFilterContext({
                section: 'surveys',
                title: 'All Surveys',
                items: surveys.list,
              })
            }
            className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-blue-400 transition-all cursor-pointer"
          >
            <span className="text-[10px] uppercase font-bold text-slate-400">Total Surveys</span>
            <div className="text-2xl font-black text-slate-900 mt-1">{surveys.total}</div>
          </div>

          <div
            onClick={() =>
              setFilterContext({
                section: 'surveys',
                title: 'Surveys: New',
                items: surveys.list.filter((s: any) => s.survey_status === 'new_survey'),
              })
            }
            className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-blue-400 transition-all cursor-pointer"
          >
            <span className="text-[10px] uppercase font-bold text-slate-500">New Surveys</span>
            <div className="text-2xl font-black text-slate-700 mt-1">{surveys.by_status.new_survey}</div>
          </div>

          <div
            onClick={() =>
              setFilterContext({
                section: 'surveys',
                title: 'Surveys: Appointed',
                items: surveys.list.filter((s: any) => s.survey_status === 'appointed' || s.survey_status === 'accepted'),
              })
            }
            className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-emerald-400 transition-all cursor-pointer"
          >
            <span className="text-[10px] uppercase font-bold text-emerald-600">Appointed</span>
            <div className="text-2xl font-black text-emerald-700 mt-1">{surveys.by_status.appointed}</div>
          </div>

          <div
            onClick={() =>
              setFilterContext({
                section: 'surveys',
                title: 'Surveys: Pending',
                items: surveys.list.filter((s: any) => s.survey_status === 'pending'),
              })
            }
            className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-amber-400 transition-all cursor-pointer"
          >
            <span className="text-[10px] uppercase font-bold text-amber-600">Pending</span>
            <div className="text-2xl font-black text-amber-700 mt-1">{surveys.by_status.pending}</div>
          </div>

          <div
            onClick={() =>
              setFilterContext({
                section: 'surveys',
                title: 'Surveys: Converted to Claim',
                items: surveys.list.filter((s: any) => !!s.converted_to_claim_id),
              })
            }
            className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-purple-400 transition-all cursor-pointer"
          >
            <span className="text-[10px] uppercase font-bold text-purple-600">Converted</span>
            <div className="text-2xl font-black text-purple-700 mt-1">{surveys.by_status.converted}</div>
          </div>
        </div>

        {/* Bar Chart: Surveys by Status */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 mb-4">
            Surveys by Appointment Status
          </h3>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={surveys.chart_data} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {surveys.chart_data.map((entry: any, index: number) => (
                    <Cell key={`cell-sv-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 3. EXPENSES & RECOVERY SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Expenses Overview */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-rose-600" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Expenses & Settlements
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div
              onClick={() =>
                setFilterContext({
                  section: 'expenses',
                  title: 'All Expenses',
                  items: expenses.list,
                })
              }
              className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-rose-400 cursor-pointer"
            >
              <span className="text-[10px] uppercase font-bold text-rose-600">Total Expenses ($)</span>
              <div className="text-xl font-black text-rose-700 mt-1">
                ${expenses.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[10px] text-slate-400">{expenses.count} total records</span>
            </div>

            <div
              onClick={() =>
                setFilterContext({
                  section: 'expenses',
                  title: 'Settled Expenses',
                  items: expenses.list.filter((e: any) => e.status === 'settled' || e.settlement_amount > 0),
                })
              }
              className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-rose-400 cursor-pointer"
            >
              <span className="text-[10px] uppercase font-bold text-slate-500">Settled ($)</span>
              <div className="text-xl font-black text-slate-900 mt-1">
                ${expenses.settled.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[10px] text-rose-500">
                Outstanding: ${expenses.outstanding.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Horizontal Bar Chart: Expenses by Type */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 mb-4">
              Expenses by Type (USD)
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={expenses.chart_data.slice(0, 6)}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 40, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="type" tick={{ fontSize: 10 }} width={90} />
                  <Tooltip />
                  <Bar dataKey="amount" fill="#f43f5e" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Recovery Overview */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Recoveries & Reimbursements
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div
              onClick={() =>
                setFilterContext({
                  section: 'recoveries',
                  title: 'All Recoveries',
                  items: recoveries.list,
                })
              }
              className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-emerald-400 cursor-pointer"
            >
              <span className="text-[10px] uppercase font-bold text-emerald-600">Total Recovery ($)</span>
              <div className="text-xl font-black text-emerald-700 mt-1">
                ${recoveries.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[10px] text-slate-400">{recoveries.count} total records</span>
            </div>

            <div
              onClick={() =>
                setFilterContext({
                  section: 'recoveries',
                  title: 'Recovered Amounts',
                  items: recoveries.list.filter((r: any) => r.recovered_amount > 0),
                })
              }
              className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-emerald-400 cursor-pointer"
            >
              <span className="text-[10px] uppercase font-bold text-slate-500">Recovered ($)</span>
              <div className="text-xl font-black text-slate-900 mt-1">
                ${recoveries.recovered.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[10px] text-emerald-600">
                Outstanding: ${recoveries.outstanding.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Horizontal Bar Chart: Recovery by Liable Party */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 mb-4">
              Recovery by Liable Party (USD)
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={recoveries.chart_data.slice(0, 6)}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 40, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="party" tick={{ fontSize: 10 }} width={90} />
                  <Tooltip />
                  <Bar dataKey="amount" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* 4. FILTERED RESULTS TABLE (Section 10) */}
      {filterContext && (
        <div className="bg-white rounded-xl border-2 border-blue-500 shadow-lg p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold uppercase tracking-wider">
                Filtered View
              </span>
              <h3 className="text-sm font-bold text-slate-900">
                {filterContext.title} ({filterContext.items.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setFilterContext(null)}
              className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 max-h-96">
            {filterContext.section === 'claims' ? (
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase text-slate-500 sticky top-0 border-b">
                  <tr>
                    <th className="p-2.5">Claim Number</th>
                    <th className="p-2.5">CMS</th>
                    <th className="p-2.5">BL</th>
                    <th className="p-2.5">Claimant</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5 text-right">Amount</th>
                    <th className="p-2.5">Handler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filterContext.items.map((c: any) => (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/claims/${c.id}`)}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                    >
                      <td className="p-2.5 font-semibold text-blue-600">{c.claim_number}</td>
                      <td className="p-2.5 text-slate-600 font-mono">{c.cms_number || '—'}</td>
                      <td className="p-2.5 font-medium text-slate-900 font-mono">{c.bl_number}</td>
                      <td className="p-2.5 text-slate-800">{c.claimant || '—'}</td>
                      <td className="p-2.5">
                        <StatusBadge status={c.status} type="claim" />
                      </td>
                      <td className="p-2.5 text-right font-medium">
                        {c.claim_amount ? `$${Number(c.claim_amount).toLocaleString()}` : '—'}
                      </td>
                      <td className="p-2.5 text-slate-700">{c.claims_handler || 'Unassigned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : filterContext.section === 'surveys' ? (
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase text-slate-500 sticky top-0 border-b">
                  <tr>
                    <th className="p-2.5">Survey Number</th>
                    <th className="p-2.5">BL</th>
                    <th className="p-2.5">Reference</th>
                    <th className="p-2.5">Requested By</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filterContext.items.map((s: any) => (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/surveys/${s.id}`)}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                    >
                      <td className="p-2.5 font-semibold text-blue-600">{s.survey_number}</td>
                      <td className="p-2.5 font-medium text-slate-900 font-mono">{s.bl_number}</td>
                      <td className="p-2.5 text-slate-600 font-mono">{s.survey_reference_number}</td>
                      <td className="p-2.5 text-slate-800">{s.survey_requested_by}</td>
                      <td className="p-2.5">
                        <StatusBadge status={s.survey_status} type="survey" />
                      </td>
                      <td className="p-2.5 text-right font-medium">
                        ${Number(s.survey_cost || 0).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-50 text-[10px] font-semibold uppercase text-slate-500 sticky top-0 border-b">
                  <tr>
                    <th className="p-2.5">Claim Number</th>
                    <th className="p-2.5">BL</th>
                    <th className="p-2.5">Type / Source</th>
                    <th className="p-2.5">Details</th>
                    <th className="p-2.5 text-right">Amount (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filterContext.items.map((it: any, idx: number) => (
                    <tr
                      key={idx}
                      onClick={() => it.claim_id && navigate(`/claims/${it.claim_id}`)}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                    >
                      <td className="p-2.5 font-semibold text-blue-600">{it.claim_number || '—'}</td>
                      <td className="p-2.5 font-medium text-slate-900 font-mono">{it.bl_number || '—'}</td>
                      <td className="p-2.5 text-slate-800 font-medium">
                        {it.expense_type || it.recovery_source || it.liable_party || '—'}
                      </td>
                      <td className="p-2.5 text-slate-600 truncate max-w-xs">{it.description || it.remarks || '—'}</td>
                      <td className="p-2.5 text-right font-bold text-slate-900">
                        ${Number(it.amount || it.recovery_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
