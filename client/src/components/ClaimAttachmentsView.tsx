import React from 'react';
import { AttachmentsPanel, AttachmentRecord } from './AttachmentsPanel';
import { MANDATORY_DOCS_DRY_CLAIM, MANDATORY_DOCS_REEFER_CLAIM } from '../constants/referenceData';
import { useAuth } from '../context/AuthContext';

interface ClaimAttachmentsViewProps {
  claim: any;
  onChangeAttachments: (attachments: AttachmentRecord[]) => void;
}

export const ClaimAttachmentsView: React.FC<ClaimAttachmentsViewProps> = ({
  claim,
  onChangeAttachments,
}) => {
  const { user } = useAuth();
  // Section 5.7 & Rule 16: upload restricted to MID/MID_GCC users
  const canUpload = ['mid', 'mid_gcc', 'admin'].includes(user?.role || '');

  const docList =
    claim.cargo_type === 'reefer'
      ? MANDATORY_DOCS_REEFER_CLAIM
      : MANDATORY_DOCS_DRY_CLAIM;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
      <div className="border-b border-slate-100 pb-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
          Mandatory Attachments ({claim.cargo_type === 'reefer' ? 'Reefer' : 'Dry'} Cargo)
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Review, upload, and track mandatory claim documentation. Upload permissions are reserved for MID/GCC personnel.
        </p>
      </div>

      <AttachmentsPanel
        documentList={docList}
        attachments={claim.attachments || []}
        canUpload={canUpload}
        onChange={onChangeAttachments}
      />
    </div>
  );
};
