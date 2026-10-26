import React, { useState } from 'react';
import { Upload, FileText, CheckCircle2 } from 'lucide-react';
import { COURT_CASE_INDICATORS, COURT_CASE_CHANCE_OPTIONS } from '../constants/referenceData';
import { api } from '../services/api';

interface CourtCaseSectionProps {
  courtCaseStatus?: string;
  courtCaseFileReference?: string;
  courtCaseLocation?: string;
  courtCaseIndicator?: string;
  courtCaseJurisdiction?: string;
  courtCaseChanceOfWinning?: string;
  courtCaseFileAttachment?: {
    file_url: string;
    file_name: string;
    uploaded_by?: string;
    uploaded_date?: string;
  } | null;
  courtCaseAttachmentComment?: string;
  canEdit: boolean;
  onSave: (fields: any) => Promise<void>;
}

export const CourtCaseSection: React.FC<CourtCaseSectionProps> = ({
  courtCaseStatus = '',
  courtCaseFileReference = '',
  courtCaseLocation = '',
  courtCaseIndicator = 'Active',
  courtCaseJurisdiction = '',
  courtCaseChanceOfWinning = 'Medium',
  courtCaseFileAttachment = null,
  courtCaseAttachmentComment = '',
  canEdit,
  onSave,
}) => {
  const [statusVal, setStatusVal] = useState(courtCaseStatus);
  const [fileRef, setFileRef] = useState(courtCaseFileReference);
  const [locationVal, setLocationVal] = useState(courtCaseLocation);
  const [indicatorVal, setIndicatorVal] = useState(courtCaseIndicator || 'Active');
  const [jurisdictionVal, setJurisdictionVal] = useState(courtCaseJurisdiction);
  const [chanceVal, setChanceVal] = useState(courtCaseChanceOfWinning || 'Medium');
  const [attachment, setAttachment] = useState(courtCaseFileAttachment);
  const [commentVal, setCommentVal] = useState(courtCaseAttachmentComment || '');
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setIsUploading(true);
    try {
      const res = await api.uploadFile(file);
      setAttachment({
        file_url: res.file_url,
        file_name: res.file_name,
        uploaded_by: res.uploaded_by,
        uploaded_date: res.uploaded_date,
      });
    } catch (err: any) {
      alert(`File upload failed: ${err.message || err}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Rule 7: Attachment or comment required
    if (!attachment && !commentVal.trim()) {
      alert('Either a court case file attachment or an explanation comment is required.');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        court_case_status: statusVal,
        court_case_file_reference: fileRef,
        court_case_location: locationVal,
        court_case_indicator: indicatorVal,
        court_case_jurisdiction: jurisdictionVal,
        court_case_chance_of_winning: chanceVal,
        court_case_file_attachment: attachment,
        court_case_attachment_comment: commentVal,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(`Failed to save court case info: ${err.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-amber-50/40 rounded-xl p-4 border border-amber-200 space-y-3.5 text-xs">
      <div className="flex items-center justify-between border-b border-amber-200 pb-2">
        <span className="font-semibold uppercase tracking-wider text-amber-900">
          Court Case Information
        </span>
        {saveSuccess && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" /> Saved
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-600 mb-0.5">Court Case Status</label>
            <input
              type="text"
              disabled={!canEdit}
              placeholder="e.g. Sub judice / Hearing fixed"
              value={statusVal}
              onChange={(e) => setStatusVal(e.target.value)}
              className="w-full bg-white rounded border border-slate-200 px-2 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-600 mb-0.5">File Reference</label>
            <input
              type="text"
              disabled={!canEdit}
              placeholder="e.g. HC/ADM 102/2026"
              value={fileRef}
              onChange={(e) => setFileRef(e.target.value)}
              className="w-full bg-white rounded border border-slate-200 px-2 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-600 mb-0.5">Location</label>
            <input
              type="text"
              disabled={!canEdit}
              placeholder="e.g. High Court Singapore"
              value={locationVal}
              onChange={(e) => setLocationVal(e.target.value)}
              className="w-full bg-white rounded border border-slate-200 px-2 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-600 mb-0.5">Indicator</label>
            <select
              disabled={!canEdit}
              value={indicatorVal}
              onChange={(e) => setIndicatorVal(e.target.value)}
              className="w-full bg-white rounded border border-slate-200 px-2 py-1.5 text-xs"
            >
              {COURT_CASE_INDICATORS.map((ind) => (
                <option key={ind} value={ind}>
                  {ind}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-600 mb-0.5">Jurisdiction</label>
            <input
              type="text"
              disabled={!canEdit}
              placeholder="e.g. English Law / Singapore"
              value={jurisdictionVal}
              onChange={(e) => setJurisdictionVal(e.target.value)}
              className="w-full bg-white rounded border border-slate-200 px-2 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-600 mb-0.5">Chance of Winning</label>
            <select
              disabled={!canEdit}
              value={chanceVal}
              onChange={(e) => setChanceVal(e.target.value)}
              className="w-full bg-white rounded border border-slate-200 px-2 py-1.5 text-xs"
            >
              {COURT_CASE_CHANCE_OPTIONS.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Attachment upload */}
        <div className="pt-2 border-t border-amber-200">
          <label className="block text-[10px] font-semibold uppercase text-slate-600 mb-1">
            Court File Attachment
          </label>
          {attachment ? (
            <div className="flex items-center justify-between p-2 bg-white rounded border border-slate-200">
              <div className="flex items-center gap-1.5 truncate">
                <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                <button
                  type="button"
                  onClick={() => api.downloadFile(attachment.file_url, attachment.file_name)}
                  className="text-blue-600 hover:underline truncate cursor-pointer text-left font-medium"
                >
                  {attachment.file_name}
                </button>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="text-[10px] text-rose-600 hover:underline cursor-pointer ml-2"
                >
                  Remove
                </button>
              )}
            </div>
          ) : (
            canEdit && (
              <label className="flex items-center justify-center gap-2 p-2.5 bg-white border border-dashed border-slate-300 rounded cursor-pointer hover:bg-slate-50 transition-colors">
                <Upload className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-600">
                  {isUploading ? 'Uploading...' : 'Upload court document (PDF / Image)'}
                </span>
                <input
                  type="file"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  className="hidden"
                />
              </label>
            )
          )}
        </div>

        {/* Comment textarea (required if no attachment) */}
        <div>
          <label className="block text-[10px] font-semibold uppercase text-slate-600 mb-1">
            Reason / Comment {!attachment && <span className="text-rose-500">* (required if no attachment)</span>}
          </label>
          <textarea
            rows={2}
            disabled={!canEdit}
            placeholder="Explain court case status or why document is unavailable..."
            value={commentVal}
            onChange={(e) => setCommentVal(e.target.value)}
            className="w-full bg-white rounded border border-slate-200 p-2 text-xs"
          />
        </div>

        {canEdit && (
          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={isSaving || (!attachment && !commentVal.trim())}
              className="px-3 py-1.5 bg-amber-600 text-white font-medium rounded hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'Saving...' : 'Save Court Case Info'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
};
