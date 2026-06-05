import type { Session } from '@/services/db';

// ─── Props ───────────────────────────────────────────────────────

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onClick: (id: string) => void;
  onDelete: (id: string) => void;
}

// ─── Component ───────────────────────────────────────────────────

/**
 * SessionItem — 单个会话项组件
 * 
 * 功能：
 * - 显示会话标题
 * - 显示创建时间
 * - 如果会话关联了能力，显示能力标签
 * - 支持删除按钮（软删除）
 */
export function SessionItem({ session, isActive, onClick, onDelete }: SessionItemProps) {
  // 格式化时间显示
  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    
    const isThisYear = date.getFullYear() === now.getFullYear();
    if (isThisYear) {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
    
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(session.id);
  };

  return (
    <div
      data-testid={`session-item-${session.id}`}
      onClick={() => onClick(session.id)}
      className={[
        'group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5',
        'transition-colors duration-150',
        isActive
          ? 'bg-primary/10 text-text-primary'
          : 'text-text-secondary hover:bg-slate-raised hover:text-text-primary',
      ].join(' ')}
    >
      {/* 能力图标（如有） */}
      {session.capability_id && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm">
          🤖
        </div>
      )}

      {/* 会话信息 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {session.title}
          </span>
          {/* 能力标签 */}
          {session.capability_name && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {session.capability_name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
          <span>{formatTime(session.last_message_at ?? session.created_at)}</span>
          {session.message_count > 0 && (
            <span>· {session.message_count} 条消息</span>
          )}
        </div>
      </div>

      {/* 删除按钮 */}
      <button
        onClick={handleDelete}
        className="shrink-0 rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
        title="删除会话"
        data-testid={`delete-session-${session.id}`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 3L7 7M7 7L11 11M7 7L3 11M7 7L11 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
