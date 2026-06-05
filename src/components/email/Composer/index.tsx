import { useState, useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { useShallow } from 'zustand/react/shallow';
import { v4 as uuidv4 } from 'uuid';
import { useEmailStore } from '@/stores/emailStore';
import type { EmailDraft } from '@/types/email';

// ── Recipient Chip Input ──────────────────────────────────────────────────────

function RecipientInput({
  label,
  recipients,
  onChange,
}: {
  label: string;
  recipients: string[];
  onChange: (recipients: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState('');

  const addRecipient = (email: string) => {
    const trimmed = email.trim();
    if (trimmed && !recipients.includes(trimmed)) {
      onChange([...recipients, trimmed]);
    }
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addRecipient(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && recipients.length > 0) {
      onChange(recipients.slice(0, -1));
    }
  };

  const handleBlur = () => {
    if (inputValue.trim()) addRecipient(inputValue);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-edge px-3 py-2 min-h-[36px]">
      <span className="shrink-0 text-[10px] text-text-tertiary w-10">{label}</span>
      {recipients.map((r) => (
        <span
          key={r}
          className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary"
        >
          {r}
          <button
            onClick={() => onChange(recipients.filter((x) => x !== r))}
            className="ml-0.5 text-primary/60 hover:text-primary"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={recipients.length === 0 ? '输入邮箱地址，按 Enter 确认' : ''}
        className="flex-1 min-w-[120px] bg-transparent text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none"
      />
    </div>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const btnCls = (active: boolean) =>
    [
      'flex h-6 w-6 items-center justify-center rounded text-xs transition-colors',
      active
        ? 'bg-primary/20 text-primary'
        : 'text-text-tertiary hover:bg-edge hover:text-text-secondary',
    ].join(' ');

  return (
    <div className="flex items-center gap-0.5 border-b border-edge px-3 py-1.5">
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={btnCls(editor.isActive('bold'))}
        title="加粗"
      >
        <strong>B</strong>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btnCls(editor.isActive('italic'))}
        title="斜体"
      >
        <em>I</em>
      </button>
      <div className="mx-1 h-4 w-px bg-edge" />
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btnCls(editor.isActive('bulletList'))}
        title="无序列表"
      >
        •≡
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btnCls(editor.isActive('orderedList'))}
        title="有序列表"
      >
        1≡
      </button>
      <div className="mx-1 h-4 w-px bg-edge" />
      <button
        onClick={() => {
          const url = window.prompt('输入链接 URL');
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}
        className={btnCls(editor.isActive('link'))}
        title="插入链接"
      >
        🔗
      </button>
    </div>
  );
}

// ── Main Composer ─────────────────────────────────────────────────────────────

export function Composer() {
  const { activeAccountId, composerInitialData, closeComposer, saveDraft, enqueueEmail } =
    useEmailStore(
      useShallow((s) => ({
        activeAccountId: s.activeAccountId,
        composerInitialData: s.composerInitialData,
        closeComposer: s.closeComposer,
        saveDraft: s.saveDraft,
        enqueueEmail: s.enqueueEmail,
      }))
    );

  const draftId = useRef(composerInitialData?.draftId ?? uuidv4());
  const [to, setTo] = useState<string[]>(composerInitialData?.to ?? []);
  const [cc, setCc] = useState<string[]>([]);
  const [subject, setSubject] = useState(composerInitialData?.subject ?? '');
  const [isDirty, setIsDirty] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial content for reply mode
  const initialContent = composerInitialData?.quotedBody
    ? `<p></p><blockquote><p>${composerInitialData.quotedBody.replace(/\n/g, '<br>')}</p></blockquote>`
    : '';

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
    ],
    content: initialContent,
    onUpdate: () => setIsDirty(true),
  });

  // Auto-save every 30 seconds
  const triggerAutoSave = useCallback(() => {
    if (!isDirty || !activeAccountId) return;
    const draft: EmailDraft = {
      id: draftId.current,
      accountId: activeAccountId,
      to,
      cc,
      subject,
      bodyHtml: editor?.getHTML() ?? '',
      inReplyTo: composerInitialData?.inReplyTo,
      updatedAt: new Date().toISOString(),
    };
    saveDraft(draft);
    setIsDirty(false);
  }, [isDirty, activeAccountId, to, cc, subject, editor, composerInitialData, saveDraft]);

  useEffect(() => {
    autoSaveTimerRef.current = setInterval(triggerAutoSave, 30_000);
    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, [triggerAutoSave]);

  const handleClose = () => {
    if (isDirty) {
      setShowCloseConfirm(true);
    } else {
      closeComposer();
    }
  };

  const handleSaveDraftAndClose = async () => {
    await triggerAutoSave();
    closeComposer();
  };

  const handleSend = async () => {
    if (!activeAccountId || to.length === 0) return;
    setSending(true);
    const bodyHtml = editor?.getHTML() ?? '';
    const bodyText = editor?.getText() ?? '';
    enqueueEmail(activeAccountId, {
      to,
      cc,
      subject,
      bodyHtml,
      bodyText,
      inReplyTo: composerInitialData?.inReplyTo,
    });
    setSending(false);
    closeComposer();
  };

  const handleAiDraft = async () => {
    setAiDrafting(true);
    try {
      // Placeholder: in production, call AI service with subject/context
      const draftContent = `<p>您好，</p><p>感谢您的来信。</p><p>此致<br>敬礼</p>`;
      editor?.commands.setContent(draftContent);
      setIsDirty(true);
    } finally {
      setAiDrafting(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-end justify-end p-4">
      <div className="flex w-full max-w-2xl flex-col rounded-2xl border border-edge bg-slate-raised shadow-2xl"
        style={{ maxHeight: '80vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <span className="text-xs font-medium text-text-primary">
            {composerInitialData?.mode === 'reply' ? '回复邮件' : '撰写新邮件'}
          </span>
          <button
            onClick={handleClose}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-edge hover:text-text-secondary"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Recipients */}
        <RecipientInput label="收件人" recipients={to} onChange={setTo} />
        <RecipientInput label="抄送" recipients={cc} onChange={setCc} />

        {/* Subject */}
        <div className="flex items-center border-b border-edge px-3 py-2">
          <span className="shrink-0 text-[10px] text-text-tertiary w-10">主题</span>
          <input
            value={subject}
            onChange={(e) => { setSubject(e.target.value); setIsDirty(true); }}
            placeholder="邮件主题"
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none"
          />
        </div>

        {/* Editor toolbar */}
        <EditorToolbar editor={editor} />

        {/* Editor body */}
        <div className="flex-1 overflow-y-auto scroll-soft px-3 py-2 min-h-[160px]">
          <EditorContent
            editor={editor}
            className="prose prose-invert prose-xs max-w-none text-xs text-text-primary focus:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[120px]"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-edge px-3 py-2">
          <button
            onClick={handleAiDraft}
            disabled={aiDrafting}
            className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
          >
            <span>✨</span>
            <span>{aiDrafting ? 'AI 起草中...' : 'AI 起草'}</span>
          </button>
          <div className="flex-1" />
          <button
            onClick={handleSend}
            disabled={sending || to.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs text-white shadow-glow transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? '发送中...' : '发送'}
          </button>
        </div>
      </div>

      {/* Close confirm dialog */}
      {showCloseConfirm && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50">
          <div className="rounded-xl border border-edge bg-slate-raised p-5 shadow-xl w-72">
            <p className="text-sm font-medium text-text-primary">保存草稿？</p>
            <p className="mt-1 text-xs text-text-tertiary">邮件尚未发送，是否保存为草稿？</p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleSaveDraftAndClose}
                className="flex-1 rounded-lg bg-primary py-1.5 text-xs text-white hover:bg-primary/90"
              >
                保存草稿
              </button>
              <button
                onClick={closeComposer}
                className="flex-1 rounded-lg border border-edge py-1.5 text-xs text-text-secondary hover:bg-edge"
              >
                丢弃
              </button>
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="flex-1 rounded-lg border border-edge py-1.5 text-xs text-text-tertiary hover:bg-edge"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
