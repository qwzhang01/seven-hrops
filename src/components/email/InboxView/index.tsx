import { useState, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEmailStore } from '@/stores/emailStore';
import type { EmailMessage } from '@/types/email';
import { ThreadView } from '../ThreadView';

// ── Skeleton Loading ──────────────────────────────────────────────────────────

function InboxSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex animate-pulse gap-3 rounded-lg p-3">
          <div className="h-8 w-8 rounded-full bg-edge" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/3 rounded bg-edge" />
            <div className="h-2.5 w-2/3 rounded bg-edge" />
            <div className="h-2 w-1/2 rounded bg-edge/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Email List Item ───────────────────────────────────────────────────────────

function EmailListItem({
  message,
  isActive,
  onClick,
}: {
  message: EmailMessage;
  isActive: boolean;
  onClick: () => void;
}) {
  const senderInitial = (message.fromName ?? message.fromEmail)[0]?.toUpperCase() ?? '?';

  // Format date: today shows time, older shows date
  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      return isToday
        ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return (
    <button
      onClick={onClick}
      className={[
        'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        isActive ? 'bg-primary/10' : 'hover:bg-edge/60',
      ].join(' ')}
    >
      {/* Avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
        {senderInitial}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={[
              'truncate text-xs',
              message.isRead ? 'text-text-secondary' : 'font-semibold text-text-primary',
            ].join(' ')}
          >
            {message.fromName ?? message.fromEmail}
          </span>
          <span className="shrink-0 text-[10px] text-text-tertiary">
            {formatDate(message.date)}
          </span>
        </div>
        <p
          className={[
            'truncate text-xs',
            message.isRead ? 'text-text-tertiary' : 'font-medium text-text-secondary',
          ].join(' ')}
        >
          {message.subject}
        </p>
        <p className="truncate text-[10px] text-text-tertiary">{message.snippet}</p>
      </div>

      {/* Unread dot */}
      {!message.isRead && (
        <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
      )}
    </button>
  );
}

// ── Main InboxView ────────────────────────────────────────────────────────────

export function InboxView() {
  const { inbox, inboxLoading, fetchInbox, openComposer } = useEmailStore(
    useShallow((s) => ({
      inbox: s.inbox,
      inboxLoading: s.inboxLoading,
      fetchInbox: s.fetchInbox,
      openComposer: s.openComposer,
    }))
  );

  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  // Client-side filtering
  const filteredInbox = useMemo(() => {
    let result = inbox;
    if (unreadOnly) result = result.filter((m) => !m.isRead);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.fromEmail.toLowerCase().includes(q) ||
          (m.fromName?.toLowerCase().includes(q) ?? false) ||
          m.subject.toLowerCase().includes(q)
      );
    }
    return result;
  }, [inbox, searchQuery, unreadOnly]);

  const activeMessage = inbox.find((m) => m.id === activeMessageId) ?? null;

  return (
    <div className="flex h-full">
      {/* Left: inbox list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-edge">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          <span className="flex-1 text-xs font-medium text-text-primary">收件箱</span>

          {/* Unread toggle */}
          <button
            onClick={() => setUnreadOnly((v) => !v)}
            className={[
              'rounded px-2 py-0.5 text-[10px] transition-colors',
              unreadOnly
                ? 'bg-primary/20 text-primary'
                : 'text-text-tertiary hover:text-text-secondary',
            ].join(' ')}
          >
            仅未读
          </button>

          {/* Refresh */}
          <button
            onClick={() => fetchInbox(true)}
            disabled={inboxLoading}
            className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-edge hover:text-text-secondary disabled:opacity-50"
            title="刷新收件箱"
          >
            <svg
              className={['h-3.5 w-3.5', inboxLoading ? 'animate-spin' : ''].join(' ')}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M13.5 8A5.5 5.5 0 112.5 8" strokeLinecap="round" />
              <path d="M13.5 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Compose */}
          <button
            onClick={() => openComposer({ mode: 'new' })}
            className="flex h-6 w-6 items-center justify-center rounded bg-primary text-white transition-colors hover:bg-primary/90"
            title="撰写邮件"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-edge px-3 py-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索发件人或主题..."
            className="w-full rounded-lg border border-edge bg-slate-deep px-2.5 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto scroll-soft">
          {inboxLoading ? (
            <InboxSkeleton />
          ) : filteredInbox.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-tertiary">
              <span className="text-2xl">📭</span>
              <p className="mt-2 text-xs">
                {searchQuery || unreadOnly ? '无匹配邮件' : '收件箱为空'}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5 p-2">
              {filteredInbox.map((msg) => (
                <EmailListItem
                  key={msg.id}
                  message={msg}
                  isActive={msg.id === activeMessageId}
                  onClick={() => setActiveMessageId(msg.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: thread detail */}
      <div className="flex-1 overflow-hidden">
        {activeMessage ? (
          <ThreadView message={activeMessage} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-text-tertiary">
            <span className="text-4xl">✉️</span>
            <p className="mt-3 text-sm">选择一封邮件查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}
