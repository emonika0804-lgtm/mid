import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  FileText,
  ClipboardList,
  CheckCircle2,
  UserCheck,
  AlertCircle,
  X,
  Check,
} from 'lucide-react';
import { api } from '../services/api';

export interface NotificationItem {
  id: string;
  type: string;
  message: string;
  claim_id?: string | null;
  user_id?: string | null;
  read: number;
  created_date: string;
}

function timeAgo(dateString: string): string {
  try {
    const now = Date.now();
    const then = new Date(dateString).getTime();
    const diffSec = Math.floor((now - then) / 1000);

    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(dateString).toLocaleDateString();
  } catch {
    return dateString;
  }
}

export const NotificationCenter: React.FC<{ collapsed?: boolean }> = ({ collapsed = false }) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const loadNotifications = async () => {
    try {
      const data = await api.getNotifications();
      if (Array.isArray(data)) {
        setNotifications(data);
      }
    } catch (err) {
      // Non-intrusive logging for background polling
      console.warn('Notification fetch notice:', err);
    }
  };

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (vw < 640) {
      // Mobile / narrow viewport (< 640px)
      // Center the panel with safe margin, guaranteeing it never overflows or clips
      const width = Math.min(360, vw - 24);
      const left = Math.max(12, Math.round((vw - width) / 2));
      const top = Math.min(Math.max(60, Math.round(rect.top - 60)), Math.max(16, vh - 440));
      const maxHeight = Math.min(480, vh - top - 16);

      setPanelStyle({
        position: 'fixed',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        maxHeight: `${maxHeight}px`,
        zIndex: 50,
      });
    } else {
      // Desktop / Tablet (>= 640px)
      // Open cleanly to the right of the sidebar in the main viewport area
      const left = Math.round(rect.right + 10);
      const maxWidth = 384; // 24rem (w-96)
      const width = Math.min(maxWidth, Math.max(300, vw - left - 16));

      const desiredHeight = 440;
      let top: number | undefined;
      let bottom: number | undefined;

      // Check if panel fits downwards from button or needs bottom anchoring
      if (rect.top + desiredHeight > vh - 16) {
        bottom = Math.max(16, vh - Math.round(rect.bottom));
        if (vh - bottom - desiredHeight < 16) {
          top = 16;
          bottom = undefined;
        }
      } else {
        top = Math.max(16, Math.round(rect.top));
      }

      const maxHeight =
        top !== undefined
          ? Math.min(desiredHeight, vh - top - 16)
          : Math.min(desiredHeight, vh - (bottom || 16) - 16);

      setPanelStyle({
        position: 'fixed',
        left: `${left}px`,
        ...(top !== undefined ? { top: `${top}px` } : {}),
        ...(bottom !== undefined ? { bottom: `${bottom}px` } : {}),
        width: `${width}px`,
        maxHeight: `${maxHeight}px`,
        zIndex: 50,
      });
    }
  }, []);

  // Update position when opened or resized
  useEffect(() => {
    if (isOpen) {
      updatePosition();
      const handleResize = () => updatePosition();
      const handleScroll = () => updatePosition();
      window.addEventListener('resize', handleResize);
      window.addEventListener('scroll', handleScroll, true);
      return () => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('scroll', handleScroll, true);
      };
    }
  }, [isOpen, collapsed, updatePosition]);

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAllRead = async () => {
    try {
      setIsLoading(true);
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
    } catch (err) {
      console.error('Failed to mark all notifications read:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSingleMarkRead = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: 1 } : n))
      );
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.read) {
      try {
        await api.markNotificationRead(item.id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, read: 1 } : n))
        );
      } catch (err) {
        console.error('Failed to mark notification read:', err);
      }
    }

    setIsOpen(false);

    if (item.claim_id) {
      navigate(`/claims/${item.claim_id}`);
    } else if (item.type === 'survey' || (item.message && item.message.toLowerCase().includes('survey'))) {
      navigate('/?tab=surveys');
    } else {
      navigate('/');
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'claim':
        return <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />;
      case 'survey':
      case 'survey_conversion':
        return <ClipboardList className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
      case 'claim_closure':
        return <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />;
      case 'handler_assigned':
        return <UserCheck className="w-4 h-4 text-indigo-500 flex-shrink-0" />;
      default:
        return <AlertCircle className="w-4 h-4 text-slate-400 flex-shrink-0" />;
    }
  };

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer w-full ${
          collapsed ? 'justify-center' : ''
        }`}
        title="Notifications"
      >
        <div className="relative flex items-center justify-center">
          <Bell className="w-4 h-4 flex-shrink-0" />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow-xs">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        {!collapsed && <span>Notifications</span>}
      </button>

      {/* Dropdown Popover (rendered into portal to prevent sidebar overflow/clipping/shifting) */}
      {isOpen &&
        createPortal(
          <>
            {/* Mobile backdrop */}
            <div
              className="fixed inset-0 bg-slate-900/30 z-40 sm:hidden"
              onClick={() => setIsOpen(false)}
            />

            <div
              ref={panelRef}
              style={panelStyle}
              className="bg-white rounded-xl shadow-2xl border border-slate-200 text-slate-800 text-xs overflow-hidden flex flex-col z-50 animate-in fade-in zoom-in-95 duration-100"
            >
              {/* Header */}
              <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-sm">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold text-[10px]">
                      {unreadCount} new
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      disabled={isLoading}
                      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium cursor-pointer disabled:opacity-50"
                      title="Mark all as read"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>Mark all read</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="overflow-y-auto divide-y divide-slate-100 flex-1 overscroll-contain">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-slate-400">
                    <Bell className="w-6 h-6 mx-auto mb-2 text-slate-300 stroke-[1.5]" />
                    <p>No notifications yet</p>
                  </div>
                ) : (
                  notifications.map((n) => {
                    const isUnread = !n.read;
                    return (
                      <div
                        key={n.id}
                        onClick={() => handleItemClick(n)}
                        className={`p-3 flex items-start gap-3 transition-colors cursor-pointer group ${
                          isUnread
                            ? 'bg-blue-50/40 hover:bg-blue-50/70'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="mt-0.5">{getIcon(n.type)}</div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-xs leading-snug line-clamp-2 ${
                              isUnread ? 'font-semibold text-slate-900' : 'text-slate-700'
                            }`}
                          >
                            {n.message}
                          </p>
                          <span className="text-[10px] text-slate-400 mt-1 block">
                            {timeAgo(n.created_date)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                          {isUnread && (
                            <>
                              <button
                                type="button"
                                onClick={(e) => handleSingleMarkRead(e, n.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-blue-100 text-blue-600 transition-opacity"
                                title="Mark as read"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <span className="w-2 h-2 rounded-full bg-blue-600 flex-shrink-0" />
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
};
