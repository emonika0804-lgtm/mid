import React, { useState } from 'react';
import { CheckCircle2, MessageSquare, AlertCircle, Upload, Download, Loader2 } from 'lucide-react';
import { api } from '../services/api';

export interface AttachmentRecord {
  type: string; // Document title/type
  file_url?: string;
  file_name?: string;
  uploaded_by?: string;
  uploaded_date?: string;
  comment?: string;
}

interface AttachmentsPanelProps {
  documentList: string[];
  attachments: AttachmentRecord[];
  canUpload?: boolean;
  onChange: (attachments: AttachmentRecord[]) => void;
}

export const AttachmentsPanel: React.FC<AttachmentsPanelProps> = ({
  documentList,
  attachments = [],
  canUpload = true,
  onChange,
}) => {
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [downloadingDoc, setDownloadingDoc] = useState<string | null>(null);

  const getAttachmentForDoc = (docTitle: string) => {
    return attachments.find((a) => a.type === docTitle);
  };

  const handleDownload = async (item: AttachmentRecord) => {
    if (!item.file_url) return;
    setDownloadingDoc(item.type);
    try {
      await api.downloadFile(item.file_url, item.file_name);
    } catch (err: any) {
      alert(`Failed to download document: ${err.message || err}`);
    } finally {
      setDownloadingDoc(null);
    }
  };

  const handleFileUpload = async (docTitle: string, file: File) => {
    setUploadingDoc(docTitle);
    try {
      const res = await api.uploadFile(file);
      const existing = getAttachmentForDoc(docTitle);

      let next: AttachmentRecord[];
      if (existing) {
        next = attachments.map((a) =>
          a.type === docTitle
            ? {
                ...a,
                file_url: res.file_url,
                file_name: res.file_name,
                uploaded_by: res.uploaded_by,
                uploaded_date: res.uploaded_date,
              }
            : a
        );
      } else {
        next = [
          ...attachments,
          {
            type: docTitle,
            file_url: res.file_url,
            file_name: res.file_name,
            uploaded_by: res.uploaded_by,
            uploaded_date: res.uploaded_date,
          },
        ];
      }
      onChange(next);
    } catch (err: any) {
      alert(`Upload failed: ${err.message || err}`);
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleCommentChange = (docTitle: string, commentText: string) => {
    const existing = getAttachmentForDoc(docTitle);
    let next: AttachmentRecord[];
    if (existing) {
      next = attachments.map((a) =>
        a.type === docTitle ? { ...a, comment: commentText } : a
      );
    } else {
      next = [...attachments, { type: docTitle, comment: commentText }];
    }
    onChange(next);
  };

  // Calculate statistics
  let uploadedCount = 0;
  let reasonCount = 0;

  for (const doc of documentList) {
    const a = getAttachmentForDoc(doc);
    if (a?.file_url) {
      uploadedCount++;
    } else if (a?.comment?.trim()) {
      reasonCount++;
    }
  }

  return (
    <div className="space-y-4">
      {/* Progress Counter */}
      <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-slate-800">
            {uploadedCount}/{documentList.length} Uploaded
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-blue-600 font-medium">
            {reasonCount} with reason provided
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span className="flex items-center gap-1 text-emerald-700">
            <CheckCircle2 className="w-3.5 h-3.5" /> Uploaded
          </span>
          <span className="flex items-center gap-1 text-blue-700">
            <MessageSquare className="w-3.5 h-3.5" /> Reason
          </span>
          <span className="flex items-center gap-1 text-amber-700">
            <AlertCircle className="w-3.5 h-3.5" /> Required
          </span>
        </div>
      </div>

      {!canUpload && (
        <div className="p-2.5 bg-amber-50 text-amber-800 border border-amber-200 rounded text-xs">
          Upload restricted to MID/MID_GCC users.
        </div>
      )}

      {/* Document Checklist */}
      <div className="space-y-3">
        {documentList.map((doc, idx) => {
          const item = getAttachmentForDoc(doc);
          const isUploaded = !!item?.file_url;
          const hasReason = !isUploaded && !!item?.comment?.trim();

          return (
            <div
              key={idx}
              className={`p-3.5 rounded-lg border transition-colors ${
                isUploaded
                  ? 'bg-emerald-50/20 border-emerald-200'
                  : hasReason
                  ? 'bg-blue-50/20 border-blue-200'
                  : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 flex-1">
                  <div className="mt-0.5 flex-shrink-0">
                    {isUploaded ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : hasReason ? (
                      <MessageSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                    )}
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-900 block leading-snug">
                      {doc}
                    </span>
                    {isUploaded && (
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                        <span className="text-emerald-700 font-medium truncate max-w-xs">
                          {item?.file_name}
                        </span>
                        {item?.uploaded_by && <span>· By {item.uploaded_by}</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isUploaded ? (
                    <button
                      type="button"
                      onClick={() => handleDownload(item!)}
                      disabled={downloadingDoc === doc}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200 font-medium transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {downloadingDoc === doc ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      Download
                    </button>
                  ) : null}

                  {canUpload && (
                    <label className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-white border border-slate-300 text-slate-700 rounded hover:bg-slate-50 cursor-pointer font-medium shadow-xs">
                      {uploadingDoc === doc ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                      ) : (
                        <Upload className="w-3.5 h-3.5 text-slate-500" />
                      )}
                      <span>{isUploaded ? 'Replace' : 'Upload'}</span>
                      <input
                        type="file"
                        className="hidden"
                        disabled={uploadingDoc === doc}
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleFileUpload(doc, e.target.files[0]);
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* If not uploaded, reason textarea */}
              {!isUploaded && (
                <div className="mt-2.5 pt-2 border-t border-slate-100">
                  <input
                    type="text"
                    placeholder="Reason if document is not available or not applicable..."
                    value={item?.comment || ''}
                    onChange={(e) => handleCommentChange(doc, e.target.value)}
                    className="w-full text-xs rounded border border-slate-200 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
