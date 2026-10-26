import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Filter, RefreshCw, FileText, ClipboardList } from 'lucide-react';
import { api } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { WORKFLOW_STATUS_ORDER, SURVEY_STATUS_ORDER } from '../constants/referenceData';
import { useAuth } from '../context/AuthContext';

export const LandingPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'claims' | 'surveys'>('claims');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [claims, setClaims] = useState<any[]>([]);
  const [surveys, setSurveys] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      if (activeTab === 'claims') {
        const data = await api.getClaims(search, statusFilter);
        setClaims(data);
      } else {
        const data = await api.getSurveys(search, statusFilter);
        setSurveys(data);
      }
    } catch (err) {
      console.error('Failed to load queue data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab, statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Cargo Claims</h1>
          <p className="text-xs text-slate-500 mt-1">
            Centralized claim & survey management — Pacific International Lines
          </p>
        </div>

        <div className="flex items-center gap-3">
          {activeTab === 'claims' ? (
            <button
              type="button"
              onClick={() => navigate('/claims/new')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New Claim
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/surveys/new')}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New Survey
            </button>
          )}
        </div>
      </div>

      {/* Tab Switcher & Filter Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Tabs */}
          <div className="flex items-center p-1 bg-slate-100 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => {
                setActiveTab('claims');
                setStatusFilter('all');
              }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'claims'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Claims
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('surveys');
                setStatusFilter('all');
              }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'surveys'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              Surveys
            </button>
          </div>

          {/* Search & Status Filter */}
          <div className="flex flex-wrap items-center gap-3">
            <form onSubmit={handleSearchSubmit} className="relative flex-1 sm:w-72">
              <input
                type="text"
                placeholder={
                  activeTab === 'claims'
                    ? 'Search claim, BL, claimant, CMS...'
                    : 'Search survey, BL, requested by...'
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            </form>

            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs rounded-lg border border-slate-200 px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Statuses</option>
                {activeTab === 'claims'
                  ? WORKFLOW_STATUS_ORDER.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))
                  : SURVEY_STATUS_ORDER.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
              </select>
            </div>

            <button
              type="button"
              onClick={loadData}
              title="Refresh"
              className="p-1.5 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Queues Table */}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          {activeTab === 'claims' ? (
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3.5">Claim Number</th>
                  <th className="py-3 px-3">CMS</th>
                  <th className="py-3 px-3">BL Number</th>
                  <th className="py-3 px-3">Claimant</th>
                  <th className="py-3 px-3 text-right">Amount</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Handler</th>
                  <th className="py-3 px-3">Created</th>
                  <th className="py-3 px-3">Discharge</th>
                  <th className="py-3 px-3">Last Action</th>
                  <th className="py-3 px-3">Time Bar</th>
                  <th className="py-3 px-3">Survey</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {isLoading ? (
                  <tr>
                    <td colSpan={12} className="py-8 text-center text-slate-400">
                      Loading claims...
                    </td>
                  </tr>
                ) : claims.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-8 text-center text-slate-400">
                      No claims found.
                    </td>
                  </tr>
                ) : (
                  claims.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/claims/${c.id}`)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-3.5 font-semibold text-blue-600">
                        {c.claim_number}
                      </td>
                      <td className="py-3 px-3 text-slate-600 font-mono text-[11px]">
                        {c.cms_number || '—'}
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-900 font-mono">
                        {c.bl_number}
                      </td>
                      <td className="py-3 px-3 text-slate-800 font-medium truncate max-w-[150px]">
                        {c.claimant || '—'}
                      </td>
                      <td className="py-3 px-3 text-right font-semibold text-slate-900">
                        {c.claim_amount !== null && c.claim_amount !== undefined
                          ? `$${Number(c.claim_amount).toLocaleString()}`
                          : '—'}
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadge status={c.status} type="claim" />
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        {c.claims_handler || 'Unassigned'}
                      </td>
                      <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                        {c.created_date ? new Date(c.created_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                        {c.discharge_date ? new Date(c.discharge_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                        {c.last_action_date ? new Date(c.last_action_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                        {c.time_bar_date ? new Date(c.time_bar_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-3">
                        {c.survey_status && c.survey_status !== 'none' ? (
                          <StatusBadge status={c.survey_status} type="survey" />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3.5">Survey Number</th>
                  <th className="py-3 px-3">BL Number</th>
                  <th className="py-3 px-3">Reference</th>
                  <th className="py-3 px-3">Requested By</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      Loading surveys...
                    </td>
                  </tr>
                ) : surveys.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No surveys found.
                    </td>
                  </tr>
                ) : (
                  surveys.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => navigate(`/surveys/${s.id}`)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-3.5 font-semibold text-blue-600">
                        {s.survey_number}
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-900 font-mono">
                        {s.bl_number}
                      </td>
                      <td className="py-3 px-3 text-slate-600 font-mono">
                        {s.survey_reference_number || '—'}
                      </td>
                      <td className="py-3 px-3 text-slate-800 font-medium">
                        {s.survey_requested_by || '—'}
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadge status={s.survey_status} type="survey" />
                      </td>
                      <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                        {s.created_date ? new Date(s.created_date).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Record count footer */}
        <div className="flex items-center justify-between text-xs text-slate-500 pt-1 px-1">
          <span>
            Showing{' '}
            <strong className="text-slate-800">
              {activeTab === 'claims' ? claims.length : surveys.length}
            </strong>{' '}
            {activeTab}
          </span>
          {user?.role === 'agency' && (
            <span className="text-slate-400 italic">
              (Filtered to records registered under your agency account)
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
