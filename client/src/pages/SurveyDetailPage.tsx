import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Search,
  Save,
  CheckCircle2,
  AlertTriangle,
  Send,
  ExternalLink,
  Loader2,
  RotateCcw,
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
import { AttachmentsPanel, AttachmentRecord } from '../components/AttachmentsPanel';
import { CommentsPanel, CommentRecord } from '../components/CommentsPanel';
import { AuditLogPanel, AuditLogItem } from '../components/AuditLogPanel';
import {
  EXPENSE_TYPES,
  RECOVERY_TYPES,
  MANDATORY_DOCS_DRY_SURVEY,
  MANDATORY_DOCS_REEFER_SURVEY,
  SURVEY_STATUS_ORDER,
} from '../constants/referenceData';

export const SurveyDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const fromClaimId = searchParams.get('from_claim');
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = !id || id === 'new';

  const isMid = ['mid', 'mid_gcc', 'admin'].includes(user?.role || '');

  // Survey State
  const [survey, setSurvey] = useState<any>({
    survey_number: '',
    survey_reference_number: '',
    cms_reference_number: '',
    survey_requested_by: '',
    survey_status: 'new_survey',
    date_of_survey: new Date().toISOString().split('T')[0],
    request_coordinator: '',
    survey_cost: '',
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
    incident_description: '',
    date_of_incident: '',
    place_of_incident: '',
    cargo_type: 'dry',
    nature_of_damage_type: '',
    selected_containers: [],
    containers_with_sizes: [],
    claim_id: null,
    originating_claim_id: null,
    originating_claim_number: null,
    converted_to_claim_id: null,
    converted_to_claim_number: null,
    expense_tally_records: [],
    recovery_tally_records: [],
    comments: [],
    attachments: [],
  });

  const [availableContainers, setAvailableContainers] = useState<ContainerItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isLmsFetching, setIsLmsFetching] = useState(false);
  const [lmsFetched, setLmsFetched] = useState(false);
  const [lmsError, setLmsError] = useState<string | null>(null);

  // Workflow update state (MID only)
  const [workflowStatus, setWorkflowStatus] = useState('new_survey');

  // Load existing survey or pre-populate from claim reroute
  useEffect(() => {
    if (!isNew && id) {
      setIsLoading(true);
      api.getSurvey(id)
        .then((data) => {
          setSurvey(data);
          setWorkflowStatus(data.survey_status || 'new_survey');
          setAvailableContainers(data.containers_with_sizes || []);
          setLmsFetched(true);
        })
        .catch((err) => {
          alert(`Error loading survey: ${err.message || err}`);
          navigate('/');
        })
        .finally(() => setIsLoading(false));
    } else if (fromClaimId) {
      // Reroute from claim
      setIsLoading(true);
      api.getClaim(fromClaimId)
        .then((clm) => {
          setSurvey((prev: any) => ({
            ...prev,
            bl_number: clm.bl_number,
            shipper: clm.shipper,
            consignee: clm.consignee,
            notify_party: clm.notify_party,
            place_of_receipt: clm.place_of_receipt,
            port_of_loading: clm.port_of_loading,
            port_of_discharge: clm.port_of_discharge,
            place_of_delivery: clm.place_of_delivery,
            vessel_code: clm.vessel_code,
            vessel_name: clm.vessel_name,
            vessel_voyage: clm.vessel_voyage,
            commodity: clm.commodity,
            discharge_date: clm.discharge_date,
            port_of_landing_date: clm.port_of_landing_date,
            port_of_discharge_date: clm.port_of_discharge_date,
            country: clm.country,
            date_of_incident: clm.date_of_incident,
            place_of_incident: clm.place_of_incident,
            cargo_type: clm.cargo_type || 'dry',
            nature_of_damage_type: clm.nature_of_damage_type,
            incident_description: clm.incident_description,
            selected_containers: clm.selected_containers || [],
            containers_with_sizes: clm.containers_with_sizes || [],
            claim_id: clm.id,
            originating_claim_id: clm.id,
            originating_claim_number: clm.claim_number,
            cms_reference_number: clm.cms_number || '',
            survey_requested_by: clm.claimant || '',
          }));
          setAvailableContainers(clm.containers_with_sizes || []);
          setLmsFetched(true);
        })
        .catch((err) => {
          console.error('Error loading originating claim:', err);
        })
        .finally(() => setIsLoading(false));
    }
  }, [id, isNew, fromClaimId]);

  // Fetch LMS Handler
  const handleFetchLMS = async () => {
    if (!survey.bl_number.trim()) {
      setLmsError('Please enter a BL Number to fetch.');
      return;
    }
    setLmsError(null);
    setIsLmsFetching(true);
    try {
      const res = await api.lookupLMS(survey.bl_number.trim());
      const d = res.data;
      const c = res.containers || [];

      setSurvey((prev: any) => ({
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

  // Validation (Rule 4)
  const getValidationErrors = () => {
    const errors: string[] = [];
    if (!lmsFetched && !survey.shipper) errors.push('fetch LMS data');
    if (!survey.survey_reference_number?.trim()) errors.push('survey reference number');
    if (isMid && !survey.cms_reference_number?.trim()) errors.push('CMS reference number');
    if (!survey.survey_requested_by?.trim()) errors.push('requesting party');
    if (!survey.date_of_survey) errors.push('date of survey');
    if (survey.survey_cost === '' || survey.survey_cost === null || isNaN(Number(survey.survey_cost))) {
      errors.push('survey cost');
    }

    const docList =
      survey.cargo_type === 'reefer'
        ? MANDATORY_DOCS_REEFER_SURVEY
        : MANDATORY_DOCS_DRY_SURVEY;

    const missingDocs: string[] = [];
    for (const doc of docList) {
      const att = (survey.attachments || []).find((a: any) => a.type === doc);
      const isOk = att?.file_url || att?.comment?.trim();
      if (!isOk) {
        missingDocs.push(doc);
      }
    }

    if (missingDocs.length > 0) {
      errors.push(`missing documents (${missingDocs.length})`);
    }

    return errors;
  };

  const validationErrors = getValidationErrors();
  const isValidToSubmit = validationErrors.length === 0;

  // Submit / Save
  const handleSaveSurvey = async () => {
    setIsSaving(true);
    try {
      if (isNew) {
        if (!isValidToSubmit) {
          alert(`Please complete the required items before submitting: ${validationErrors.join(', ')}`);
          setIsSaving(false);
          return;
        }
        const created = await api.createSurvey(survey);
        alert(`Survey ${created.survey_number} created successfully!`);
        navigate(`/surveys/${created.id}`);
      } else {
        const updated = await api.updateSurvey(id!, survey);
        setSurvey(updated);
        alert('Survey updates saved successfully!');
      }
    } catch (err: any) {
      alert(`Save failed: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Convert to Claim (Section 6.3 & Rule 14)
  const handleConvertToClaim = async () => {
    if (!window.confirm('Are you sure you want to convert this appointed survey into a formal cargo claim? All survey information, containers, incident details, and tallies will be transferred.')) {
      return;
    }

    setIsConverting(true);
    try {
      const res = await api.convertSurveyToClaim(id!);
      alert(`Survey converted to claim ${res.claim_number} successfully!`);
      navigate(`/claims/${res.claim_id}`);
    } catch (err: any) {
      alert(`Conversion failed: ${err.message || err}`);
    } finally {
      setIsConverting(false);
    }
  };

  // Workflow update by MID
  const handleUpdateWorkflow = async () => {
    setIsSaving(true);
    try {
      const updated = await api.updateSurvey(id!, {
        survey_status: workflowStatus,
      });
      setSurvey(updated);
      alert('Survey status updated successfully!');
    } catch (err: any) {
      alert(`Failed to update status: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const totalExpenses = (survey.expense_tally_records || []).reduce(
    (acc: number, r: TallyRecord) => acc + (Number(r.amount_usd) || 0),
    0
  );
  const totalRecovery = (survey.recovery_tally_records || []).reduce(
    (acc: number, r: TallyRecord) => acc + (Number(r.amount_usd) || 0),
    0
  );

  const canConvertToClaim =
    !isNew &&
    isMid &&
    (survey.survey_status === 'appointed' || survey.survey_status === 'accepted') &&
    !survey.converted_to_claim_id;

  if (isLoading) {
    return (
      <div className="h-64 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Loading Survey Details...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 6.1 Header */}
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
                  {isNew
                    ? fromClaimId
                      ? 'New Survey (Rerouted from Claim)'
                      : 'New Survey Request'
                    : survey.survey_number}
                </h1>
                {!isNew && <StatusBadge status={survey.survey_status} type="survey" />}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isNew
                  ? 'Appoint a marine surveyor for cargo condition verification'
                  : `BL: ${survey.bl_number} · Ref: ${survey.survey_reference_number}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleSaveSurvey}
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
              {isNew ? 'Submit Survey Request' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Banners */}
        {survey.originating_claim_id && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-xs text-amber-900">
            <span>
              📋 Rerouted from Claim{' '}
              <strong className="font-semibold">{survey.originating_claim_number || 'Claim'}</strong>
            </span>
            <Link
              to={`/claims/${survey.originating_claim_id}`}
              className="inline-flex items-center gap-1 font-semibold text-amber-800 underline"
            >
              View Rerouted Claim <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {survey.converted_to_claim_id && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-900">
            <span>
              ✅ Converted to Claim{' '}
              <strong className="font-semibold">{survey.converted_to_claim_number}</strong>
            </span>
            <Link
              to={`/claims/${survey.converted_to_claim_id}`}
              className="inline-flex items-center gap-1 font-semibold text-emerald-800 underline"
            >
              Open Converted Claim <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>

      {/* 6.2 Left Column (2/3 width) & 6.3 Right Sidebar (1/3 width) */}
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
                    value={survey.bl_number}
                    onChange={(e) =>
                      setSurvey({ ...survey, bl_number: e.target.value.toUpperCase() })
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

              {/* LMS grid excluding container_number, seal_number, weight, quantity, package_type, port_of_discharge_date, country for surveys */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-2">
                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Shipper</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.shipper || ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Consignee</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.consignee || ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Notify Party</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.notify_party || ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Place of Receipt</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.place_of_receipt || ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Port of Loading</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.port_of_loading || ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Port of Discharge</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.port_of_discharge || ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Place of Delivery</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.place_of_delivery || ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Vessel Code</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.vessel_code || ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Vessel Name</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.vessel_name || ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Vessel Voyage</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.vessel_voyage || ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Commodity</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.commodity || ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Discharge Date</label>
                  <input
                    type="text"
                    readOnly
                    disabled
                    value={survey.discharge_date ? new Date(survey.discharge_date).toLocaleDateString() : ''}
                    className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs bg-slate-50 text-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-semibold uppercase text-blue-700 mb-0.5">
                    Port of Loading Date [Editable]
                  </label>
                  <input
                    type="date"
                    value={survey.port_of_landing_date ? survey.port_of_landing_date.split('T')[0] : ''}
                    onChange={(e) => setSurvey({ ...survey, port_of_landing_date: e.target.value })}
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
              selectedContainerNumbers={survey.selected_containers || []}
              onChange={(selected, containersWithSizes) =>
                setSurvey({
                  ...survey,
                  selected_containers: selected,
                  containers_with_sizes: containersWithSizes,
                })
              }
            />
          </SectionCard>

          {/* 3. Incident Information */}
          <SectionCard title="Incident Information">
            <IncidentFields
              dateOfIncident={survey.date_of_incident}
              placeOfIncident={survey.place_of_incident}
              cargoType={survey.cargo_type}
              natureOfDamageType={survey.nature_of_damage_type}
              incidentDescription={survey.incident_description}
              onChange={(fields) => setSurvey({ ...survey, ...fields })}
            />
          </SectionCard>

          {/* 4. Survey Information (5 mandatory fields) */}
          <SectionCard title="Survey Information">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Survey Reference Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SRV-REF-109"
                  value={survey.survey_reference_number || ''}
                  onChange={(e) => setSurvey({ ...survey, survey_reference_number: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  CMS Reference Number {isMid && <span className="text-rose-500">*</span>}{' '}
                  {!isMid && <span className="text-[10px] text-slate-400 font-normal">(MID only)</span>}
                </label>
                <input
                  type="text"
                  disabled={!isMid}
                  placeholder={isMid ? 'e.g. CMS-2026-090' : '(MID only)'}
                  value={survey.cms_reference_number || ''}
                  onChange={(e) => setSurvey({ ...survey, cms_reference_number: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Survey Requesting Party <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Marine Surveyors Co."
                  value={survey.survey_requested_by || ''}
                  onChange={(e) => setSurvey({ ...survey, survey_requested_by: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Date of Survey <span className="text-rose-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={survey.date_of_survey ? survey.date_of_survey.split('T')[0] : ''}
                  onChange={(e) => setSurvey({ ...survey, date_of_survey: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Request Coordinator
                </label>
                <input
                  type="text"
                  placeholder="e.g. Alfred Tan"
                  value={survey.request_coordinator || ''}
                  onChange={(e) => setSurvey({ ...survey, request_coordinator: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Survey Cost (USD) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="0.00"
                  value={survey.survey_cost !== undefined ? survey.survey_cost : ''}
                  onChange={(e) => setSurvey({ ...survey, survey_cost: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
            </div>
          </SectionCard>

          {/* 5. Expenses / Tally */}
          <SectionCard title="Expenses / Tally">
            <TallyTable
              title="Survey Expense Records"
              typeOptions={EXPENSE_TYPES}
              records={survey.expense_tally_records || []}
              canEdit={true}
              onChange={(recs) => setSurvey({ ...survey, expense_tally_records: recs })}
            />
          </SectionCard>

          {/* 6. Recovery / Tally */}
          <SectionCard title="Recovery / Tally">
            <TallyTable
              title="Survey Recovery Records"
              typeOptions={RECOVERY_TYPES}
              records={survey.recovery_tally_records || []}
              isRecovery={true}
              canEdit={true}
              onChange={(recs) => setSurvey({ ...survey, recovery_tally_records: recs })}
            />
          </SectionCard>

          {/* 7. Net Amount Summary */}
          <NetAmountSummary
            totalExpensesUsd={totalExpenses}
            totalRecoveryUsd={totalRecovery}
          />

          {/* 8. Mandatory Attachments (Survey checklist) */}
          <SectionCard
            title={`Mandatory Attachments (${survey.cargo_type === 'reefer' ? 'Reefer' : 'Dry'} Survey)`}
          >
            <AttachmentsPanel
              documentList={
                survey.cargo_type === 'reefer'
                  ? MANDATORY_DOCS_REEFER_SURVEY
                  : MANDATORY_DOCS_DRY_SURVEY
              }
              attachments={survey.attachments || []}
              canUpload={true}
              onChange={(atts) => setSurvey({ ...survey, attachments: atts })}
            />
          </SectionCard>

          {/* Submit Button Bar */}
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
                    All mandatory validations met. Ready to submit survey request.
                  </span>
                )
              ) : (
                <span>Ensure all survey tallies and documents are saved.</span>
              )}
            </div>

            <button
              type="button"
              onClick={handleSaveSurvey}
              disabled={isSaving || (isNew && !isValidToSubmit)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors cursor-pointer w-full sm:w-auto justify-center"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isNew ? 'Submit Survey Request' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Right Sidebar (1/3 width) (Section 6.3) */}
        <div className="space-y-6">
          {/* 1. Survey Workflow (MID only, existing surveys) */}
          {!isNew && (
            <SectionCard title="Survey Workflow">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current Status</span>
                  <StatusBadge status={survey.survey_status} type="survey" />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">
                    Update Status {!isMid && <span className="text-[10px] text-slate-400 font-normal">(MID only)</span>}
                  </label>
                  <select
                    disabled={!isMid}
                    value={workflowStatus}
                    onChange={(e) => setWorkflowStatus(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    {SURVEY_STATUS_ORDER.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                {isMid && (
                  <button
                    type="button"
                    onClick={handleUpdateWorkflow}
                    disabled={isSaving}
                    className="w-full py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    Update Status
                  </button>
                )}
              </div>
            </SectionCard>
          )}

          {/* 2. Convert to Claim Button (Section 6.3 & Rule 14) */}
          {canConvertToClaim && (
            <div className="bg-emerald-50/50 rounded-xl border border-emerald-200 p-4 shadow-xs">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-900 mb-1">
                Convert Survey to Claim
              </span>
              <p className="text-xs text-slate-600 mb-3 leading-relaxed">
                This survey has been appointed. MID personnel can promote this survey into a full cargo claim.
              </p>
              <button
                type="button"
                onClick={handleConvertToClaim}
                disabled={isConverting}
                className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                {isConverting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                Convert to Claim
              </button>
            </div>
          )}

          {/* 3. Currency Conversion Widget */}
          <CurrencyConverter initialAmount={survey.survey_cost ? Number(survey.survey_cost) : 1000} />

          {/* 4. Comments Panel */}
          <CommentsPanel
            comments={survey.comments || []}
            onAddComment={(newComment) => {
              const updated = [...(survey.comments || []), newComment];
              setSurvey({ ...survey, comments: updated });
              if (!isNew) {
                api.updateSurvey(id!, { comments: updated });
              }
            }}
          />

          {/* 5. Audit Log */}
          {!isNew && <AuditLogPanel logs={auditLogs} />}
        </div>
      </div>
    </div>
  );
};
