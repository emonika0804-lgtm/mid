import React from 'react';
import { EmailCommunication, EmailMessage } from './EmailCommunication';

interface ClaimFeedViewProps {
  claim: any;
  canEdit: boolean;
  onSendEmail: (msg: EmailMessage) => void;
  onUpdateEmails?: (uEmail: string, vEmail: string) => void;
}

export const ClaimFeedView: React.FC<ClaimFeedViewProps> = ({
  claim,
  canEdit,
  onSendEmail,
  onUpdateEmails,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
      <div className="border-b border-slate-100 pb-3 mb-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">
          Email Feed & Communications
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Correspondence thread with claimant, surveyor, and internal stakeholders.
        </p>
      </div>

      <EmailCommunication
        userEmail={claim.user_email}
        vendorEmail={claim.vendor_email}
        cmsNumber={claim.cms_number}
        claimNumber={claim.claim_number}
        blNumber={claim.bl_number}
        emailThread={claim.email_thread || []}
        canEdit={canEdit}
        onSendEmail={onSendEmail}
        onUpdateEmails={onUpdateEmails}
      />
    </div>
  );
};
