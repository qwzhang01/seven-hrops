import { useState, useRef, useEffect } from 'react';
import { useMusicStore } from '@/stores/musicStore';

interface UserMenuPopoverProps {
  onOpenSettings?: () => void;
  onOpenLLMConfig?: () => void;
  onOpenWhitelist?: () => void;
  onOpenMusicPlayer?: () => void;
  onOpenHelp?: () => void;
  onOpenFeedback?: () => void;
  onLogout?: () => void;
}

/**
 * UserMenuPopover — bottom user info area with expandable menu.
 * Help & Feedback are handled internally with built-in modals.
 */
export function UserMenuPopover({
  onOpenSettings,
  onOpenLLMConfig,
  onOpenWhitelist,
  onOpenMusicPlayer,
  onOpenHelp,
  onOpenFeedback,
  onLogout,
}: UserMenuPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { toggle: toggleMusicPlayer } = useMusicStore();

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const menuItems = [
    { icon: '⚙️', label: '系统设置', onClick: onOpenSettings },
    { icon: '🤖', label: '大模型配置', onClick: onOpenLLMConfig },
    { icon: '🌐', label: '浏览器白名单', onClick: onOpenWhitelist },
    {
      icon: '📻',
      label: '音乐播放器',
      onClick: () => {
        toggleMusicPlayer();
        onOpenMusicPlayer?.();
        setIsOpen(false);
      },
    },
    {
      icon: '❓',
      label: '帮助文档',
      onClick: () => {
        if (onOpenHelp) {
          onOpenHelp();
        } else {
          setShowHelp(true);
        }
        setIsOpen(false);
      },
    },
    {
      icon: '💬',
      label: '意见反馈',
      onClick: () => {
        if (onOpenFeedback) {
          onOpenFeedback();
        } else {
          setShowFeedback(true);
        }
        setIsOpen(false);
      },
    },
    { icon: '🚪', label: '退出登录', onClick: onLogout, danger: true },
  ];

  return (
    <>
      <div ref={containerRef} className="relative">
        {/* Popover menu */}
        {isOpen && (
          <div
            className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-edge bg-slate-raised shadow-lg animate-float-in"
            role="menu"
            aria-label="用户菜单"
          >
            {menuItems.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                onClick={() => {
                  item.onClick?.();
                  if (item.label !== '音乐播放器') setIsOpen(false);
                }}
                className={[
                  'flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                  (item as { danger?: boolean }).danger
                    ? 'text-error hover:bg-error/10'
                    : 'text-text-secondary hover:bg-edge hover:text-text-primary',
                ].join(' ')}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Trigger button */}
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-slate-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-expanded={isOpen}
          aria-haspopup="menu"
        >
          {/* Avatar — logo */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full overflow-hidden bg-primary/10">
            <img src="/logo-white.png" alt="logo" className="h-7 w-7 object-contain" style={{ mixBlendMode: 'screen' }} />
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="truncate text-sm font-medium text-text-primary">Avin Zhang</div>
          </div>
          <span className="text-xs text-text-tertiary">{isOpen ? '▲' : '▼'}</span>
        </button>
      </div>

      {/* ── Help Modal ── */}
      {showHelp && (
        <InlineModal title="帮助文档" onClose={() => setShowHelp(false)}>
          <div className="space-y-3 text-sm text-text-secondary">
            <p>Seven HROps 是一款 AI 驱动的 HR 工作助手，帮助您高效完成招聘、面试、简历筛选等工作。</p>
            <div className="space-y-1.5">
              <p className="font-medium text-text-primary">快速上手</p>
              <ul className="space-y-1 pl-4 text-xs">
                <li>• 在聊天框输入需求，AI 将自动识别并执行任务</li>
                <li>• 点击功能卡片快速启动对应工作流</li>
                <li>• 左侧导航可切换浏览器、邮箱等工具</li>
              </ul>
            </div>
            <p className="text-xs text-text-tertiary">版本 v0.1.0 · 更多文档即将上线</p>
          </div>
        </InlineModal>
      )}

      {/* ── Feedback Modal ── */}
      {showFeedback && (
        <InlineModal title="意见反馈" onClose={() => setShowFeedback(false)}>
          <div className="space-y-3 text-sm text-text-secondary">
            <p>感谢您使用 Seven HROps！您的反馈对我们非常重要。</p>
            <div className="rounded-lg border border-edge bg-slate-deep p-3 text-xs">
              <p className="mb-1 font-medium text-text-primary">联系方式</p>
              <p>📧 782264826@qq.com</p>
              <p className="mt-1 text-text-tertiary">我们会在 1-3 个工作日内回复您</p>
            </div>
            <p className="text-xs text-text-tertiary">在线反馈功能即将上线，敬请期待</p>
          </div>
        </InlineModal>
      )}
    </>
  );
}

// ── Inline modal (portal-free, fixed overlay) ─────────────────────────────────
function InlineModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-float-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-edge bg-slate-raised p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-edge hover:text-text-secondary"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
