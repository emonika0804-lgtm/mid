import React, { useState } from 'react';
import { Mail, Send, Paperclip, Reply, ArrowUpRight, ArrowDownLeft, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';

export interface EmailMessage {
  id: string;
  direction: 'sent' | 'received';
  from_email: string;
  to_email: string;
  subject: string;
  body: string;
  timestamp: string;
  attachments?: Array<{
    file_url: string;
    file_name: string;
    file_type?: string;
    file_size?: number;
  }>;
  reply_to_id?: string;
}

interface EmailCommunicationProps {
  userEmail?: string;
  vendorEmail?: string;
  cmsNumber?: string;
  claimNumber?: string;
  blNumber?: string;
  emailThread: EmailMessage[];
  canEdit?: boolean;
  onSendEmail: (email: EmailMessage) => void;
  onUpdateEmails?: (userEmail: string, vendorEmail: string) => void;
}

export const EmailCommunication: React.FC<EmailCommunicationProps> = ({
  userEmail = '',
  vendorEmail = '',
  cmsNumber = '',
  claimNumber = '',
  blNumber = '',
  emailThread = [],
  canEdit = true,
  onSendEmail,
  onUpdateEmails,
}) => {
  const { user } = useAuth();
  const [isComposing, setIsComposing] = useState(false);
  const [toEmail, setToEmail] = useState(vendorEmail || '');
  const [subject, setSubject] = useState(
    `[PIL Claims] ${claimNumber || blNumber} - Ref: ${cmsNumber || 'Claim Inquiry'}`
  );
  const [bodyText, setBodyText] = useState('');
  const [attachments, setAttachments] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [replyToId, setReplyToId] = useState<string | undefined>(undefined);

  // Email address editing state
  const [uEmail, setUEmail] = useState(userEmail || user?.email || '');
  const [vEmail, setVEmail] = useState(vendorEmail || '');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setIsUploading(true);
    try {
      const res = await api.uploadFile(e.target.files[0]);
      setAttachments([...attachments, res]);
    } catch (err: any) {
      alert(`Upload error: ${err.message || err}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSend = () => {
    if (!toEmail.trim() || !bodyText.trim()) {
      alert('Recipient email and message body are required.');
      return;
    }

    const newMsg: EmailMessage = {
      id: `msg-${Date.now()}`,
      direction: 'sent',
      from_email: uEmail || user?.email || 'claims@pilship.com',
      to_email: toEmail.trim(),
      subject: subject.trim(),
      body: bodyText.trim(),
      timestamp: new Date().toISOString(),
      attachments,
      reply_to_id: replyToId,
    };

    onSendEmail(newMsg);
    if (onUpdateEmails) {
      onUpdateEmails(uEmail, vEmail);
    }

    setIsComposing(false);
    setBodyText('');
    setAttachments([]);
    setReplyToId(undefined);
  };

  const handleReply = (msg: EmailMessage) => {
    setToEmail(msg.direction === 'sent' ? msg.to_email : msg.from_email);
    setSubject(msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`);
    setReplyToId(msg.id);
    setIsComposing(true);
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Configuration Header */}
      <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">
              User Email ID
            </label>
            <input
              type="email"
              disabled={!canEdit}
              placeholder="user@pilship.com"
              value={uEmail}
              onChange={(e) => {
                setUEmail(e.target.value);
                if (onUpdateEmails) onUpdateEmails(e.target.value, vEmail);
              }}
              className="w-full bg-white rounded border border-slate-200 px-2.5 py-1 text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">
              Vendor Email ID
            </label>
            <input
              type="email"
              disabled={!canEdit}
              placeholder="vendor@logistics.com"
              value={vEmail}
              onChange={(e) => {
                setVEmail(e.target.value);
                if (onUpdateEmails) onUpdateEmails(uEmail, e.target.value);
              }}
              className="w-full bg-white rounded border border-slate-200 px-2.5 py-1 text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">
              CMS Reference Number
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={cmsNumber || '—'}
              className="w-full bg-slate-100 rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-600 font-mono"
            />
          </div>
        </div>

        <div className="mt-3 flex justify-between items-center pt-2.5 border-t border-slate-200">
          <span className="text-slate-500">
            Thread contains <span className="font-semibold text-slate-700">{emailThread.length}</span> messages
          </span>
          {canEdit && !isComposing && (
            <button
              type="button"
              onClick={() => {
                setToEmail(vEmail || '');
                setIsComposing(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              Compose Email
            </button>
          )}
        </div>
      </div>

      {/* Composer Modal / Drawer */}
      {isComposing && canEdit && (
        <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-sm space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="font-semibold text-slate-800 text-xs uppercase tracking-wider flex items-center gap-1.5">
              <Mail className="w-4 h-4 text-blue-600" />
              {replyToId ? 'Reply Email' : 'Compose Message'}
            </span>
            <button
              type="button"
              onClick={() => setIsComposing(false)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Reference Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-slate-400">Attached References:</span>
            {claimNumber && (
              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[10px] font-mono">
                {claimNumber}
              </span>
            )}
            {blNumber && (
              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full text-[10px] font-mono">
                BL: {blNumber}
              </span>
            )}
            {cmsNumber && (
              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-[10px] font-mono">
                CMS: {cmsNumber}
              </span>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">To</label>
            <input
              type="email"
              placeholder="recipient@domain.com"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded border border-slate-200 px-2.5 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-0.5">Message</label>
            <textarea
              rows={4}
              placeholder="Type your message here..."
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="w-full rounded border border-slate-200 p-2.5 text-xs"
            />
          </div>

          {/* Attachments */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-700 rounded hover:bg-slate-200 cursor-pointer text-xs font-medium">
                <Paperclip className="w-3.5 h-3.5" />
                <span>{isUploading ? 'Uploading...' : 'Attach File'}</span>
                <input
                  type="file"
                  className="hidden"
                  disabled={isUploading}
                  onChange={handleFileUpload}
                />
              </label>

              {attachments.map((att, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[11px]"
                >
                  {att.file_name}
                  <button
                    type="button"
                    onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))}
                    className="hover:text-rose-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsComposing(false)}
                className="px-3 py-1.5 border border-slate-200 rounded text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Send Email
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Thread */}
      <div className="space-y-3">
        {emailThread.length === 0 ? (
          <div className="text-center py-6 text-slate-400 bg-slate-50/50 rounded-lg border border-dashed border-slate-200">
            No emails sent or received for this claim yet.
          </div>
        ) : (
          emailThread.map((msg) => {
            const isSent = msg.direction === 'sent';
            return (
              <div
                key={msg.id}
                className={`p-3.5 rounded-xl border ${
                  isSent
                    ? 'bg-blue-50/20 border-blue-100 ml-4'
                    : 'bg-white border-slate-200 mr-4'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        isSent
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {isSent ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownLeft className="w-3 h-3" />}
                      {isSent ? 'Sent' : 'Received'}
                    </span>
                    <span className="font-semibold text-slate-900">{msg.subject}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {new Date(msg.timestamp).toLocaleString()}
                  </span>
                </div>

                <div className="text-[11px] text-slate-500 mb-2 flex items-center gap-3">
                  <span>
                    From: <strong className="text-slate-700">{msg.from_email}</strong>
                  </span>
                  <span>
                    To: <strong className="text-slate-700">{msg.to_email}</strong>
                  </span>
                </div>

                <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed bg-white/60 p-2.5 rounded border border-slate-100">
                  {msg.body}
                </p>

                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-slate-400">Attachments:</span>
                    {msg.attachments.map((att, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => api.downloadFile(att.file_url, att.file_name)}
                        className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline bg-slate-50 px-2 py-0.5 rounded border border-slate-200 cursor-pointer"
                      >
                        <Paperclip className="w-3 h-3" />
                        {att.file_name}
                      </button>
                    ))}
                  </div>
                )}

                {canEdit && (
                  <div className="mt-2.5 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleReply(msg)}
                      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                    >
                      <Reply className="w-3 h-3" />
                      Reply
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
