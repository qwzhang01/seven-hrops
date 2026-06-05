import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { invoke } from '@tauri-apps/api/core';
import { useEmailStore } from '@/stores/emailStore';
import { useShallow } from 'zustand/react/shallow';
import type { EmailMessage } from '@/types/email';

// ── Thread Message Item ───────────────────────────────────────────────────────

function ThreadMessageItem({
  message,
  isExpanded,
  onToggle,
}: {
  message: EmailMessage;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  // Sanitize HTML content
  const safeHtml = message.bodyHtml
    ? DOMPurify.sanitize(message.bodyHtml, {
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
      })
    : null;

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="rounded-xl border border-edge bg-slate-raised overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-edge/40"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
          {(message.fromName ?? message.fromEmail)[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-text-primary">
            {message.fromName ?? message.fromEmail}
          </p>
          <p className="text-[10px] text-text-tertiary">{formatDate(message.date)}</p>
        </div>
        {!isExpanded && (
          <p className="truncate max-w-[200px] text-[10px] text-text-tertiary">
            {message.snippet}
          </p>
        )}
        <svg
          className={['h-4 w-4 shrink-0 text-text-tertiary transition-transform', isExpanded ? 'rotate-180' : ''].join(' ')}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Body — visible when expanded */}
      {isExpanded && (
        <div className="border-t border-edge px-4 py-3">
          {/* To/CC info */}
          <div className="mb-3 space-y-0.5 text-[10px] text-text-tertiary">
            <p>收件人：{message.to.join(', ')}</p>
            {message.cc.length > 0 && <p>抄送：{message.cc.join(', ')}</p>}
          </div>

          {/* Email body */}
          {safeHtml ? (
            <iframe
              srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;font-size:13px;color:#e2e8f0;background:transparent;margin:0;padding:0}a{color:#818cf8}</style></head><body>${safeHtml}</body></html>`}
              sandbox="allow-same-origin"
              className="w-full min-h-[200px] border-0"
              style={{ height: 'auto' }}
              onLoad={(e) => {
                const iframe = e.currentTarget;
                if (iframe.contentDocument) {
                  iframe.style.height =
                    iframe.contentDocument.documentElement.scrollHeight + 'px';
                }
              }}
            />
          ) : (
            <pre className="whitespace-pre-wrap text-xs text-text-secondary font-sans">
              {message.bodyText ?? message.snippet}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ThreadView ───────────────────────────────────────────────────────────

export function ThreadView({ message }: { message: EmailMessage }) {
  const { openComposer } = useEmailStore(useShallow((s) => ({ openComposer: s.openComposer })));

  const [thread, setThread] = useState<EmailMessage[]>([message]);
  const [loadingThread, setLoadingThread] = useState(false);
  // Latest message expanded, others collapsed
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set([message.id]));

  // Load full thread when message changes
  useEffect(() => {
    setThread([message]);
    setExpandedIds(new Set([message.id]));

    if (message.messageId) {
      setLoadingThread(true);
      invoke<EmailMessage[]>('get_thread', {
        accountId: message.accountId,
        messageId: message.messageId,
      })
        .then((msgs) => {
          if (msgs.length > 0) {
            setThread(msgs);
            // Expand only the latest
            const latestId = msgs[msgs.length - 1].id;
            setExpandedIds(new Set([latestId]));
          }
        })
        .catch((err) => console.error('[ThreadView] Failed to load thread:', err))
        .finally(() => setLoadingThread(false));
    }
  }, [message.id]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleReply = () => {
    openComposer({
      mode: 'reply',
      to: [message.fromEmail],
      subject: message.subject.startsWith('Re:')
        ? message.subject
        : `Re: ${message.subject}`,
      inReplyTo: message.messageId,
      quotedBody: message.bodyText ?? message.snippet,
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 className="flex-1 truncate text-sm font-medium text-text-primary">
          {message.subject}
        </h2>
        <button
          onClick={handleReply}
          className="ml-3 flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-edge hover:text-text-primary"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 8l4-4v2.5c5 0 8 2 8 6.5-1.5-3-4-4-8-4V11L2 8z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          回复
        </button>
      </div>

      {/* Thread messages */}
      <div className="flex-1 overflow-y-auto scroll-soft p-4 space-y-2">
        {loadingThread && (
          <p className="text-center text-xs text-text-tertiary">加载线程中...</p>
        )}
        {thread.map((msg) => (
          <ThreadMessageItem
            key={msg.id}
            message={msg}
            isExpanded={expandedIds.has(msg.id)}
            onToggle={() => toggleExpand(msg.id)}
          />
        ))}
      </div>
    </div>
  );
}
