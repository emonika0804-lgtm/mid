import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Search,
  Save,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Send,
  ExternalLink,
  Loader2,
  Edit3,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SectionCard } from '../components/SectionCard';
import { StatusBadge } from '../components/StatusBadge';
import { ContainerSelector, ContainerItem } from '../components/ContainerSelector';
import { IncidentFields } from '../components/IncidentFields';
import { TallyTable, TallyRecord } from '../components/TallyTable';
import { NetAmountSummary } from '../components/NetAmountSummary';
import { CurrencyConverter } from '../components/CurrencyConverter';
import { WorkflowControl } from '../components/WorkflowControl';
import { CourtCaseSection } from '../components/CourtCaseSection';
import { PolicyInformation } from '../components/PolicyInformation';
import { AffiliatedClaimNumber } from '../components/AffiliatedClaimNumber';
import { AttachmentsPanel, AttachmentRecord } from '../components/AttachmentsPanel';
import { CommentsPanel, CommentRecord } from '../components/CommentsPanel';
import { EmailCommunication, EmailMessage } from '../components/EmailCommunication';
import { ResponseTimeline, ResponseHistoryItem } from '../components/ResponseTimeline';
import { AuditLogPanel, AuditLogItem } from '../components/AuditLogPanel';
import { ClaimReadOnlyView } from '../components/ClaimReadOnlyView';
import { ClaimFeedView } from '../components/ClaimFeedView';
import { ClaimAttachmentsView } from '../components/ClaimAttachmentsView';
import {
  CLAIMANT_TYPES,
  EXPENSE_TYPES,
  RECOVERY_TYPES,
  CLAIMS_HANDLERS,
  MANDATORY_DOCS_DRY_CLAIM,
  MANDATORY_DOCS_REEFER_CLAIM,
} from '../constants/referenceData';

export const ClaimDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = !id || id === 'new';

  const isMid = ['mid', 'mid_gcc', 'admin'].includes(user?.role || '');

  // Tab state (only existing claims show tabs)
  const [activeTab, setActiveTab] = useState<'details' | 'readonly' | 'feed' | 'attachments'>('details');

  // Claim State
  const [claim, setClaim] = useState<any>({
    claim_number: '',
    cms_number: '',
    bl_number: '',
    shipper: '',
    consignee: '',
    notify_party: '',
    place_of_receipt: '',
    port_of_loading: '',
    port_of_discharge: '',
    place_of_delivery: '',
    vessel_code: '',
    vessel_name: '',
    vessel_voyage: '',
    commodity: '',
    discharge_date: '',
    port_of_landing_date: '',
    port_of_discharge_date: '',
    country: '',
    claim_amount: '',
    claimant: '',
    claimant_type: 'Consignee',
    status: 'new_claim',
    awaiting_input_reason: '',
    closed_reason: '',
    court_case_status: '',
    court_case_file_reference: '',
    court_case_location: '',
    court_case_indicator: 'Active',
    court_case_jurisdiction: '',
    court_case_chance_of_winning: 'Medium',
    court_case_file_attachment: null,
    court_case_attachment_comment: '',
    user_email: '',
    vendor_email: '',
    claims_handler: '',
    time_bar_date: '',
    sla_status: 'green',
    survey_status: 'none',
    survey_case_number: '',
    incident_description: '',
    date_of_incident: '',
    place_of_incident: '',
    cargo_type: 'dry',
    nature_of_damage_type: '',
    selected_containers: [],
    containers_with_sizes: [],
    policy_deductible_type: '',
    policy_pi_club: '',
    policy_number: '',
    policy_deductible_usd: null,
    affiliated_claim_number: '',
    reference_number: '',
    expense_tally_records: [],
    recovery_tally_records: [],
    email_thread: [],
    claim_amount_history: [],
    response_received_history: [],
    comments: [],
    attachments: [],
    linked_surveys: [],
  });

  const [availableContainers, setAvailableContainers] = useState<ContainerItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLmsFetching, setIsLmsFetching] = useState(false);
  const [lmsFetched, setLmsFetched] = useState(false);
  const [lmsError, setLmsError] = useState<string | null>(null);

  // Claim Amount Edit modal / mode
  const [isEditingAmount, setIsEditingAmount] = useState(false);
  const [newAmountVal, setNewAmountVal] = useState('');
  const [amountEditReason, setAmountEditReason] = useState('');

  // Load existing claim
  useEffect(() => {
    if (!isNew && id) {
      setIsLoading(true);
      api.getClaim(id)
        .then((data) => {
          setClaim(data);
          setAvailableContainers(data.containers_with_sizes || []);
          setLmsFetched(true);
          return api.getClaimAudit(id);
        })
        .then((logs) => {
          setAuditLogs(logs || []);
        })
        .catch((err) => {
          alert(`Error loading claim: ${err.message || err}`);
          navigate('/');
        })
        .finally(() => setIsLoading(false));
    }
  }, [id, isNew]);

  // LMS Lookup Handler
  const handleFetchLMS = async () => {
    if (!claim.bl_number.trim()) {
      setLmsError('Please enter a BL Number to fetch.');
      return;
    }
    setLmsError(null);
    setIsLmsFetching(true);
    try {
      const res = await api.lookupLMS(claim.bl_number.trim());
      const d = res.data;
      const c = res.containers || [];

      // Calculate time bar = 1 year from discharge_date
      let calculatedTimeBar = claim.time_bar_date;
      if (d.discharge_date) {
        const bd = new Date(d.discharge_date);
        bd.setFullYear(bd.getFullYear() + 1);
        calculatedTimeBar = bd.toISOString().split('T')[0];
      }

      setClaim((prev: any) => ({
        ...prev,
        shipper: d.shipper || '',
        consignee: d.consignee || '',
        notify_party: d.notify_party || '',
        place_of_receipt: d.place_of_receipt || '',
        port_of_loading: d.port_of_loading || '',
        port_of_discharge: d.port_of_discharge || '',
        place_of_delivery: d.place_of_delivery || '',
        vessel_code: d.vessel_code || '',
        vessel_name: d.vessel_name || '',
        vessel_voyage: d.vessel_voyage || '',
        commodity: d.commodity || '',
        discharge_date: d.discharge_date || '',
        port_of_landing_date: d.port_of_loading_date || '',
        port_of_discharge_date: d.port_of_discharge_date || '',
        country: d.country || '',
        time_bar_date: calculatedTimeBar,
        selected_containers: c.map((cnt: any) => cnt.container_number),
        containers_with_sizes: c,
      }));

      setAvailableContainers(c);
      setLmsFetched(true);
    } catch (err: any) {
      setLmsError(err.message || 'BL not found in LMS records');
    } finally {
      setIsLmsFetching(false);
    }
  };

  // Claim submission validation (Rule 3)
  const getValidationErrors = () => {
    const errors: string[] = [];
    if (!lmsFetched && !claim.shipper) {
      errors.push('fetch LMS data');
    }
    if (!claim.claimant || !claim.claimant.trim()) {
      errors.push('enter claimant');
    }
    if (
      !claim.date_of_incident ||
      !claim.place_of_incident ||
      !claim.cargo_type ||
      !claim.nature_of_damage_type ||
      !claim.incident_description?.trim()
    ) {
      errors.push('complete incident info');
    }

    // Check mandatory documents
    const docList =
      claim.cargo_type === 'reefer'
        ? MANDATORY_DOCS_REEFER_CLAIM
        : MANDATORY_DOCS_DRY_CLAIM;

    const missingDocs: string[] = [];
    for (const doc of docList) {
      const att = (claim.attachments || []).find((a: any) => a.type === doc);
      const isOk = att?.file_url || att?.comment?.trim();
      if (!isOk) {
        missingDocs.push(doc);
      }
    }

    if (missingDocs.length > 0) {
      errors.push(`missing attachments: ${missingDocs.slice(0, 2).join(', ')}${missingDocs.length > 2 ? ` (+${missingDocs.length - 2} more)` : ''}`);
    }

    return errors;
  };

  const validationErrors = getValidationErrors();
  const isValidToSubmit = validationErrors.length === 0;

  // Save or Submit
  const handleSaveClaim = async () => {
    setIsSaving(true);
    try {
      if (isNew) {
        if (!isValidToSubmit) {
          alert(`Please complete the required items before submitting: ${validationErrors.join(', ')}`);
          setIsSaving(false);
          return;
        }
        const created = await api.createClaim(claim);
        alert(`Claim ${created.claim_number} submitted successfully!`);
        navigate(`/claims/${created.id}`);
      } else {
        const updated = await api.updateClaim(id!, claim);
        setClaim(updated);
        // Refresh audit logs
        const logs = await api.getClaimAudit(id!);
        setAuditLogs(logs || []);
        alert('All claim updates saved successfully!');
      }
    } catch (err: any) {
      alert(`Save failed: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Rule 8: Claim Amount Edit
  const canEditAmount = isNew || claim.status === 'new_claim' || isMid;

  const handleSaveAmount = async () => {
    const amtNum = parseFloat(newAmountVal);
    if (isNaN(amtNum) || amtNum < 0) {
      alert('Please enter a valid amount');
      return;
    }
    if (!amountEditReason.trim()) {
      alert('Please provide a reason for the amount modification');
      return;
    }

    try {
      const updated = await api.updateClaim(id!, {
        claim_amount: amtNum,
        claim_amount_reason: amountEditReason.trim(),
      });
      setClaim(updated);
      setIsEditingAmount(false);
      setNewAmountVal('');
      setAmountEditReason('');
      alert('Claim amount updated successfully');
    } catch (err: any) {
      alert(`Failed to update amount: ${err.message || err}`);
    }
  };

  // Right sidebar workflow changes save
  const handleSaveWorkflowAndHandler = async () => {
    setIsSaving(true);
    try {
      const updated = await api.updateClaim(id!, {
        status: claim.status,
        awaiting_input_reason: claim.awaiting_input_reason,
        closed_reason: claim.closed_reason,
        claims_handler: claim.claims_handler,
        time_bar_date: claim.time_bar_date,
      });
      setClaim(updated);
      const logs = await api.getClaimAudit(id!);
      setAuditLogs(logs || []);
      alert('Workflow, handler, and time-bar settings saved.');
    } catch (err: any) {
      alert(`Update failed: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Reroute to Survey (Rule 13)
  const handleRerouteToSurvey = () => {
    if (claim.originating_survey_id) {
      navigate(`/surveys/${claim.originating_survey_id}`);
    } else {
      navigate(`/surveys/new?from_claim=${claim.id}`);
    }
  };

  // Net amounts calculation
  const totalExpenses = (claim.expense_tally_records || []).reduce(
    (acc: number, r: TallyRecord) => acc + (Number(r.amount_usd) || 0),
    0
  );
  const totalRecovery = (claim.recovery_tally_records || []).reduce(
    (acc: number, r: TallyRecord) => acc + (Number(r.amount_usd) || 0),
    0
  );

  if (isLoading) {
    return (
      <div className="h-64 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Loading Claim Details...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 5.1 Header */}
      <div className="space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer transition-colors"
              title="Back to Queues"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  {isNew ? 'New Cargo Claim' : claim.claim_number}
                </h1>
                {!isNew && <StatusBadge status={claim.status} type="claim" />}
                {!isNew && <StatusBadge status={claim.sla_status || 'green'} type="sla" />}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isNew
                  ? 'Initiate a new cargo claim record with shipment lookup'
                  : `BL: ${claim.bl_number} · Discharge: ${claim.port_of_discharge || '—'}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleSaveClaim}
              disabled={isSaving || (isNew && !isValidToSubmit)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isNew ? (
                <Send className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {isNew ? 'Submit Claim' : 'Save All Changes'}
            </button>
          </div>
        </div>

        {/* Banners */}
        {claim.originating_survey_id && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between text-xs text-blue-900">
            <span>
              ℹ️ Originated from Survey{' '}
              <strong className="font-semibold">{claim.originating_survey_number}</strong>
            </span>
            <Link
              to={`/surveys/${claim.originating_survey_id}`}
              className="inline-flex items-center gap-1 font-semibold text-blue-700 underline"
            >
              View Originating Survey <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {claim.survey_status === 'appointed' && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-900">
            <span>
              ⚓ Survey appointed — Case Ref:{' '}
              <strong className="font-semibold">{claim.survey_case_number || 'Appointed'}</strong>
            </span>
            {claim.linked_surveys && claim.linked_surveys[0] && (
              <Link
                to={`/surveys/${claim.linked_surveys[0].id}`}
                className="inline-flex items-center gap-1 font-semibold text-emerald-700 underline"
              >
                View Appointed Survey <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        )}
      </div>

      {/* 5.2 Tabs (Existing claims only) */}
      {!isNew && (
        <div className="flex items-center border-b border-slate-200 space-x-6 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`pb-3 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'details'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Claim Details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('readonly')}
            className={`pb-3 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'readonly'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Details (Read-Only)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('feed')}
            className={`pb-3 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'feed'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Feed
            {(claim.email_thread || []).length > 0 && (
              <span className="px-1.5 py-0.2 bg-blue-100 text-blue-700 rounded-full text-[10px]">
                {claim.email_thread.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('attachments')}
            className={`pb-3 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'attachments'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Mandatory Attachments
          </button>
        </div>
      )}

      {/* TAB CONTENT */}
      {activeTab === 'readonly' && !isNew ? (
        <ClaimReadOnlyView claim={claim} />
      ) : activeTab === 'feed' && !isNew ? (
        <ClaimFeedView
          claim={claim}
          canEdit={true}
          onSendEmail={(msg) => {
            const updatedThread = [...(claim.email_thread || []), msg];
            setClaim({ ...claim, email_thread: updatedThread });
            api.updateClaim(id!, { email_thread: updatedThread });
          }}
          onUpdateEmails={(uEmail, vEmail) => {
            setClaim({ ...claim, user_email: uEmail, vendor_email: vEmail });
            api.updateClaim(id!, { user_email: uEmail, vendor_email: vEmail });
          }}
        />
      ) : activeTab === 'attachments' && !isNew ? (
        <ClaimAttachmentsView
          claim={claim}
          onChangeAttachments={(atts) => {
            setClaim({ ...claim, attachments: atts });
            api.updateClaim(id!, { attachments: atts });
          }}
        />
      ) : (
        /* Default: Claim Details Tab with 2/3 and 1/3 columns */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column (2/3 width) */}
          <div className="lg:col-span-2 space-y-6">
            {/* 1. LMS Lookup Card */}
            <SectionCard title="Bill of Lading — LMS Lookup">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="flex-1">
                    <input
                      type="text"
                      disabled={!isNew}
                      placeholder="Enter BL Number (e.g. PIL0100001)..."
                      value={claim.bl_number}
                      onChange={(e) =>
                        setClaim({ ...claim, bl_number: e.target.value.toUpperCase() })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>

                  {isNew ? (
                    <button
                      type="button"
                      onClick={handleFetchLMS}
                      disabled={isLmsFetching}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#002B49] text-white rounded-lg text-xs font-semibold hover:bg-blue-900 disabled:opacity-50 cursor-pointer"
                    >
                      {isLmsFetching ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                      Fetch from LMS
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400 font-medium self-center">
                      (BL locked)
                    </span>
                  )}
                </div>

                {lmsError && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                    {lmsError}
                  </div>
                )}

                {/* LMS 3-column grid excluding container, seal, weight, quantity, package_type, port_of_discharge_date (Rule 11) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-2">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Shipper</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.shipper || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Consignee</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.consignee || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Notify Party</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.notify_party || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Place of Receipt</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.place_of_receipt || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Port of Loading</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.port_of_loading || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Port of Discharge</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.port_of_discharge || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Place of Delivery</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.place_of_delivery || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Vessel Code</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.vessel_code || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Vessel Name</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.vessel_name || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Vessel Voyage</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.vessel_voyage || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Commodity</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.commodity || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Country</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.country || ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Discharge Date</label>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={claim.discharge_date ? new Date(claim.discharge_date).toLocaleDateString() : ''}
                      className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                    />
                  </div>

                  {/* Rule 12: Port of Landing Date displays as "Port of Loading Date" and is editable */}
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-blue-700 mb-0.5">
                      Port of Loading Date [Editable]
                    </label>
                    <input
                      type="date"
                      value={claim.port_of_landing_date ? claim.port_of_landing_date.split('T')[0] : ''}
                      onChange={(e) => setClaim({ ...claim, port_of_landing_date: e.target.value })}
                      className="w-full rounded border border-blue-200 px-2.5 py-1.5 text-xs bg-white"
                    />
                  </div>

                  {/* Editable Port of Discharge Date */}
                  <div>
                    <label className="block text-[10px] font-semibold uppercase text-blue-700 mb-0.5">
                      Port of Discharge Date [Editable]
                    </label>
                    <input
                      type="date"
                      value={claim.port_of_discharge_date ? claim.port_of_discharge_date.split('T')[0] : ''}
                      onChange={(e) => setClaim({ ...claim, port_of_discharge_date: e.target.value })}
                      className="w-full rounded border border-blue-200 px-2.5 py-1.5 text-xs bg-white"
                    />
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* 2. Container Selection */}
            <SectionCard title="Container Selection">
              <ContainerSelector
                containers={availableContainers}
                selectedContainerNumbers={claim.selected_containers || []}
                onChange={(selected, containersWithSizes) =>
                  setClaim({
                    ...claim,
                    selected_containers: selected,
                    containers_with_sizes: containersWithSizes,
                  })
                }
              />
            </SectionCard>

            {/* 3. Incident Information */}
            <SectionCard title="Incident Information">
              <IncidentFields
                dateOfIncident={claim.date_of_incident}
                placeOfIncident={claim.place_of_incident}
                cargoType={claim.cargo_type}
                natureOfDamageType={claim.nature_of_damage_type}
                incidentDescription={claim.incident_description}
                onChange={(fields) => setClaim({ ...claim, ...fields })}
              />
            </SectionCard>

            {/* 4. Claim Information */}
            <SectionCard title="Claim Information">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Claimant <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Enter claimant entity / company..."
                    value={claim.claimant || ''}
                    onChange={(e) => setClaim({ ...claim, claimant: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Claimant Type
                  </label>
                  <select
                    value={claim.claimant_type || 'Consignee'}
                    onChange={(e) => setClaim({ ...claim, claimant_type: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white"
                  >
                    {CLAIMANT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {/* CMS Reference Number (MID only) */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    CMS Reference Number {!isMid && <span className="text-[10px] text-slate-400 font-normal">(MID only)</span>}
                  </label>
                  <input
                    type="text"
                    disabled={!isMid}
                    placeholder={isMid ? 'e.g. CMS-2026-901' : '(MID only)'}
                    value={claim.cms_number || ''}
                    onChange={(e) => setClaim({ ...claim, cms_number: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>

                {/* Claim Amount (Section 5.3 & Rule 8) */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Claim Amount (USD)
                  </label>
                  {isNew ? (
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={claim.claim_amount || ''}
                      onChange={(e) => setClaim({ ...claim, claim_amount: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    />
                  ) : (
                    <div className="flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-slate-50">
                      <span className="font-bold text-slate-900">
                        {claim.claim_amount !== null && claim.claim_amount !== undefined
                          ? `$${Number(claim.claim_amount).toLocaleString()}`
                          : 'Not set'}
                      </span>
                      {canEditAmount && !isEditingAmount && (
                        <button
                          type="button"
                          onClick={() => {
                            setNewAmountVal(String(claim.claim_amount || ''));
                            setIsEditingAmount(true);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Amount Edit Mode (Rule 8) */}
              {isEditingAmount && !isNew && (
                <div className="mt-3 p-3 bg-blue-50/50 rounded-lg border border-blue-200 space-y-2 text-xs">
                  <div className="font-semibold text-blue-900 uppercase text-[10px]">
                    Update Claim Amount
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">New Amount (USD)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={newAmountVal}
                        onChange={(e) => setNewAmountVal(e.target.value)}
                        className="w-full bg-white rounded border border-slate-200 px-2 py-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Reason for change</label>
                      <input
                        type="text"
                        placeholder="e.g. Revised surveyor report received"
                        value={amountEditReason}
                        onChange={(e) => setAmountEditReason(e.target.value)}
                        className="w-full bg-white rounded border border-slate-200 px-2 py-1 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsEditingAmount(false)}
                      className="px-2.5 py-1 rounded border border-slate-200 text-slate-600 bg-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAmount}
                      className="px-3 py-1 rounded bg-blue-600 text-white font-medium hover:bg-blue-700"
                    >
                      Save Amount
                    </button>
                  </div>
                </div>
              )}

              {/* Amount Change History */}
              {!isNew && (claim.claim_amount_history || []).length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <span className="block text-[10px] font-semibold uppercase text-slate-400 mb-1.5">
                    Amount Modification History
                  </span>
                  <div className="space-y-1 text-[11px] text-slate-600">
                    {claim.claim_amount_history.map((h: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-1.5 bg-slate-50 rounded">
                        <span>
                          <strong>${Number(h.new_amount).toLocaleString()}</strong> ({h.reason})
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {h.user} · {new Date(h.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>

            {/* 5. Expenses / Tally of Expenses */}
            <SectionCard title="Expenses / Tally of Expenses / Settlement">
              <TallyTable
                title="Expense Records"
                typeOptions={EXPENSE_TYPES}
                records={claim.expense_tally_records || []}
                canEdit={true}
                onChange={(recs) => setClaim({ ...claim, expense_tally_records: recs })}
              />
            </SectionCard>

            {/* 6. Recovery / Tally of Recovery */}
            <SectionCard title="Recovery / Tally of Recovery / Reimbursement">
              <TallyTable
                title="Recovery Records"
                typeOptions={RECOVERY_TYPES}
                records={claim.recovery_tally_records || []}
                isRecovery={true}
                canEdit={true}
                onChange={(recs) => setClaim({ ...claim, recovery_tally_records: recs })}
              />
            </SectionCard>

            {/* 7. Net Amount Summary */}
            <NetAmountSummary
              totalExpensesUsd={totalExpenses}
              totalRecoveryUsd={totalRecovery}
            />

            {/* 8. Policy Information */}
            <SectionCard title="Policy Information">
              <PolicyInformation
                deductibleType={claim.policy_deductible_type}
                piClub={claim.policy_pi_club}
                policyNumber={claim.policy_number}
                deductibleUsd={claim.policy_deductible_usd}
                canEdit={true}
                onChange={(fields) => setClaim({ ...claim, ...fields })}
              />
            </SectionCard>

            {/* 9. Affiliated Claim Number */}
            <SectionCard title="Affiliated Claim & Reference">
              <AffiliatedClaimNumber
                affiliatedClaimNumber={claim.affiliated_claim_number}
                referenceNumber={claim.reference_number}
                canEdit={true}
                onChange={(fields) => setClaim({ ...claim, ...fields })}
              />
            </SectionCard>

            {/* 10. Mandatory Attachments Panel */}
            <SectionCard title={`Mandatory Attachments (${claim.cargo_type === 'reefer' ? 'Reefer' : 'Dry'})`}>
              <AttachmentsPanel
                documentList={
                  claim.cargo_type === 'reefer'
                    ? MANDATORY_DOCS_REEFER_CLAIM
                    : MANDATORY_DOCS_DRY_CLAIM
                }
                attachments={claim.attachments || []}
                canUpload={true}
                onChange={(atts) => setClaim({ ...claim, attachments: atts })}
              />
            </SectionCard>

            {/* 11. Email Communication */}
            <SectionCard title="Email Communication">
              <EmailCommunication
                userEmail={claim.user_email}
                vendorEmail={claim.vendor_email}
                cmsNumber={claim.cms_number}
                claimNumber={claim.claim_number}
                blNumber={claim.bl_number}
                emailThread={claim.email_thread || []}
                canEdit={true}
                onSendEmail={(msg) =>
                  setClaim({ ...claim, email_thread: [...(claim.email_thread || []), msg] })
                }
                onUpdateEmails={(uEmail, vEmail) =>
                  setClaim({ ...claim, user_email: uEmail, vendor_email: vEmail })
                }
              />
            </SectionCard>

            {/* Submit / Save Button Bar at bottom of Left Column */}
            <div className="p-4 bg-white rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
              <div className="text-xs text-slate-500">
                {isNew ? (
                  !isValidToSubmit ? (
                    <span className="text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                      Required: {validationErrors.join(', ')}
                    </span>
                  ) : (
                    <span className="text-emerald-600 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                      All mandatory validations met. Ready to submit claim.
                    </span>
                  )
                ) : (
                  <span>Ensure all tally and container updates are reviewed before saving.</span>
                )}
              </div>

              <button
                type="button"
                onClick={handleSaveClaim}
                disabled={isSaving || (isNew && !isValidToSubmit)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors cursor-pointer w-full sm:w-auto justify-center"
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {isNew ? 'Submit Claim' : 'Save All Changes'}
              </button>
            </div>
          </div>

          {/* Right Sidebar (1/3 width) (Section 5.4) */}
          <div className="space-y-6">
            {/* 1. Workflow Control */}
            <SectionCard title="Workflow & Status">
              <WorkflowControl
                status={claim.status}
                awaitingInputReason={claim.awaiting_input_reason}
                closedReason={claim.closed_reason}
                canEdit={isMid}
                onChange={(updates) => setClaim({ ...claim, ...updates })}
              />

              {/* Claims Handler (MID only, existing claims) */}
              {!isNew && (
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">
                    Claims Handler {!isMid && <span className="text-[10px] text-slate-400 font-normal">(MID only)</span>}
                  </label>
                  <select
                    disabled={!isMid}
                    value={claim.claims_handler || ''}
                    onChange={(e) => setClaim({ ...claim, claims_handler: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    <option value="">Unassigned</option>
                    {CLAIMS_HANDLERS.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Time Bar Date (MID only, existing claims) */}
              {!isNew && (
                <div className="mt-3">
                  <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">
                    Time Bar Date {!isMid && <span className="text-[10px] text-slate-400 font-normal">(MID only)</span>}
                  </label>
                  <input
                    type="date"
                    disabled={!isMid}
                    value={claim.time_bar_date ? claim.time_bar_date.split('T')[0] : ''}
                    onChange={(e) => setClaim({ ...claim, time_bar_date: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>
              )}

              {/* Save Workflow Button (MID only) */}
              {isMid && !isNew && (
                <div className="mt-4 pt-2">
                  <button
                    type="button"
                    onClick={handleSaveWorkflowAndHandler}
                    disabled={isSaving}
                    className="w-full py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    Save Status & Handler
                  </button>
                </div>
              )}
            </SectionCard>

            {/* 2. Court Case Information (Conditional: status=awaiting_input AND reason=court_case) */}
            {claim.status === 'awaiting_input' && claim.awaiting_input_reason === 'court_case' && (
              <CourtCaseSection
                courtCaseStatus={claim.court_case_status}
                courtCaseFileReference={claim.court_case_file_reference}
                courtCaseLocation={claim.court_case_location}
                courtCaseIndicator={claim.court_case_indicator}
                courtCaseJurisdiction={claim.court_case_jurisdiction}
                courtCaseChanceOfWinning={claim.court_case_chance_of_winning}
                courtCaseFileAttachment={claim.court_case_file_attachment}
                courtCaseAttachmentComment={claim.court_case_attachment_comment}
                canEdit={isMid}
                onSave={async (fields) => {
                  setClaim({ ...claim, ...fields });
                  if (!isNew) {
                    await api.updateClaim(id!, fields);
                  }
                }}
              />
            )}

            {/* 3. Reroute to Survey Button (existing claims) */}
            {!isNew && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Survey Reroute
                </span>
                <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                  {claim.originating_survey_id
                    ? 'This claim was converted from an appointed survey.'
                    : 'Dispatch surveyor request for joint cargo inspection.'}
                </p>
                <button
                  type="button"
                  onClick={handleRerouteToSurvey}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 border border-blue-600 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-50 transition-colors cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {claim.originating_survey_id ? 'Go to Linked Survey' : 'Reroute to Survey'}
                </button>
              </div>
            )}

            {/* 4. Currency Conversion Widget */}
            <CurrencyConverter initialAmount={claim.claim_amount ? Number(claim.claim_amount) : 1000} />

            {/* 5. Comments Panel with @-mention */}
            <CommentsPanel
              comments={claim.comments || []}
              onAddComment={(newComment) => {
                const updated = [...(claim.comments || []), newComment];
                setClaim({ ...claim, comments: updated });
                if (!isNew) {
                  api.updateClaim(id!, { comments: updated });
                }
              }}
            />

            {/* 6. Response Received Tracker */}
            {!isNew && (
              <ResponseTimeline
                history={claim.response_received_history || []}
                canEdit={true}
                onAddResponse={(newItem) => {
                  const updated = [...(claim.response_received_history || []), newItem];
                  setClaim({ ...claim, response_received_history: updated });
                  api.updateClaim(id!, { response_received_history: updated });
                }}
              />
            )}

            {/* 7. Audit Log */}
            {!isNew && <AuditLogPanel logs={auditLogs} />}

            {/* 8. Linked Surveys */}
            {!isNew && (claim.linked_surveys || []).length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Linked Surveys ({claim.linked_surveys.length})
                </span>
                <div className="space-y-2">
                  {claim.linked_surveys.map((sv: any) => (
                    <div
                      key={sv.id}
                      onClick={() => navigate(`/surveys/${sv.id}`)}
                      className="p-2.5 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold text-blue-600 text-xs">
                          {sv.survey_number}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Ref: {sv.survey_reference_number}
                        </div>
                      </div>
                      <StatusBadge status={sv.survey_status} type="survey" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
