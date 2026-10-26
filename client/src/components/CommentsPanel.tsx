import React, { useState, useRef, useEffect } from 'react';
import { Send, AtSign } from 'lucide-react';
import { CLAIMS_HANDLERS } from '../constants/referenceData';
import { useAuth } from '../context/AuthContext';

export interface CommentRecord {
  text: string;
  user: string;
  timestamp: string;
  mentions?: string[];
}

interface CommentsPanelProps {
  comments: CommentRecord[];
  onAddComment: (comment: CommentRecord) => void;
}

export const CommentsPanel: React.FC<CommentsPanelProps> = ({ comments = [], onAddComment }) => {
  const { user } = useAuth();
  const [inputText, setInputText] = useState('');
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mention suggestions: claims handlers + current user
  const mentionCandidates = Array.from(
    new Set([user?.full_name || 'Me', ...CLAIMS_HANDLERS])
  );

  const filteredCandidates = mentionCandidates.filter((name) =>
    name.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const lastAtPos = textBeforeCursor.lastIndexOf('@');

    if (lastAtPos !== -1 && (lastAtPos === 0 || /\s/.test(textBeforeCursor[lastAtPos - 1]))) {
      const query = textBeforeCursor.slice(lastAtPos + 1);
      if (!/\s/.test(query)) {
        setMentionFilter(query);
        setShowMentionMenu(true);
        setMentionIndex(0);
        return;
      }
    }
    setShowMentionMenu(false);
  };

  const insertMention = (name: string) => {
    if (!textareaRef.current) return;
    const cursorPos = textareaRef.current.selectionStart;
    const textBeforeCursor = inputText.slice(0, cursorPos);
    const lastAtPos = textBeforeCursor.lastIndexOf('@');
    const textAfterCursor = inputText.slice(cursorPos);

    const newText = textBeforeCursor.slice(0, lastAtPos) + `@${name} ` + textAfterCursor;
    setInputText(newText);
    setShowMentionMenu(false);

    setTimeout(() => {
      if (textareaRef.current) {
        const nextPos = lastAtPos + name.length + 2;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextPos, nextPos);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionMenu && filteredCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredCandidates.length) % filteredCandidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredCandidates[mentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!inputText.trim()) return;

    // Detect mentions
    const mentions: string[] = [];
    const mentionRegex = /@([A-Za-z0-9\s]+?)(?=\s|$|[.,!?])/g;
    let match;
    while ((match = mentionRegex.exec(inputText)) !== null) {
      mentions.push(match[1].trim());
    }

    const newComment: CommentRecord = {
      text: inputText.trim(),
      user: user?.full_name || 'User',
      timestamp: new Date().toISOString(),
      mentions,
    };

    onAddComment(newComment);
    setInputText('');
    setShowMentionMenu(false);
  };

  // Render text highlighting mentions in blue
  const renderMessageContent = (text: string) => {
    const parts = text.split(/(@[A-Za-z0-9\s]+?)(?=\s|$|[.,!?])/);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return (
          <span key={i} className="font-semibold text-blue-600 bg-blue-50 px-1 rounded">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className="flex flex-col h-[380px] bg-slate-50/50 rounded-xl border border-slate-200 overflow-hidden text-xs">
      {/* Header */}
      <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wider text-slate-700 text-[11px]">
          Internal Comments ({comments.length})
        </span>
        <span className="text-[10px] text-slate-400">Type @ to mention team members</span>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 p-3.5 overflow-y-auto space-y-3">
        {comments.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400">
            <p>No comments yet.</p>
            <p className="text-[10px]">Start the discussion by sending a message below.</p>
          </div>
        ) : (
          comments.map((c, i) => {
            const isMe = user?.full_name && c.user === user.full_name;
            return (
              <div
                key={i}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  <span className="font-medium text-slate-600 text-[10px]">{c.user}</span>
                  <span className="text-slate-400 text-[9px]">
                    {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 leading-relaxed ${
                    isMe
                      ? 'bg-blue-600 text-white rounded-br-xs'
                      : 'bg-white text-slate-800 border border-slate-200 rounded-bl-xs'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{renderMessageContent(c.text)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="p-2.5 bg-white border-t border-slate-200 relative">
        {/* Mention autocomplete menu */}
        {showMentionMenu && filteredCandidates.length > 0 && (
          <div className="absolute bottom-full left-2.5 mb-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-20">
            <div className="px-2.5 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-500 uppercase flex items-center gap-1">
              <AtSign className="w-3 h-3" /> Mention team member
            </div>
            <div className="max-h-40 overflow-y-auto divide-y divide-slate-100">
              {filteredCandidates.map((candidate, idx) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => insertMention(candidate)}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between cursor-pointer ${
                    idx === mentionIndex ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span>{candidate}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={2}
            placeholder="Write a comment... (Type @ to mention)"
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="flex-1 rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
