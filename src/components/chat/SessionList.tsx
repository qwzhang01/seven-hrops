import { useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { SessionItem } from './SessionItem';

// ─── Props ───────────────────────────────────────────────────────

interface SessionListProps {
  onSelectSession?: (sessionId: string) => void;
}

// ─── Component ───────────────────────────────────────────────────

/**
 * SessionList — 会话列表组件
 * 
 * 功能：
 * - 显示会话标题、创建时间
 * - 如果会话关联了能力，显示能力标签
 * - 支持删除会话（软删除）
 * - 一次展示最多 5 个会话，下拉自动加载剩余会话（分页）
 */
export function SessionList({ onSelectSession }: SessionListProps) {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const loading = useSessionStore((state) => state.loading);
  const hasMore = useSessionStore((state) => state.hasMore);
  const loadMore = useSessionStore((state) => state.loadMore);
  const deleteSession = useSessionStore((state) => state.deleteSession);
  const refreshSessionList = useSessionStore((state) => state.refreshSessionList);

  const listRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // 初始加载
  useEffect(() => {
    refreshSessionList();
  }, [refreshSessionList]);

  // 无限滚动加载
  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list || loadingRef.current) return;

    const threshold = 100; // 距离底部 100px 时触发加载
    const isNearBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < threshold;

    if (isNearBottom && hasMore && !loading) {
      loadingRef.current = true;
      loadMore().finally(() => {
        loadingRef.current = false;
      });
    }
  }, [hasMore, loading, loadMore]);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.addEventListener('scroll', handleScroll);
      return () => list.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // 选择会话
  const handleSelect = (sessionId: string) => {
    useSessionStore.getState().setActiveSession(sessionId);
    onSelectSession?.(sessionId);
  };

  // 删除会话
  const handleDelete = async (sessionId: string) => {
    if (confirm('确定要删除这个会话吗？')) {
      await deleteSession(sessionId);
    }
  };

  return (
    <div
      ref={listRef}
      data-testid="session-list"
      className="h-full overflow-y-auto scroll-soft px-2 py-2"
    >
      {/* 会话列表 */}
      {sessions.length === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-3 text-4xl">💬</div>
          <div className="text-sm text-text-secondary">暂无会话</div>
          <div className="mt-1 text-xs text-text-tertiary">
            开始一个新的对话吧
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={session.id === activeSessionId}
              onClick={handleSelect}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* 加载状态 */}
      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="text-xs text-text-tertiary">加载中...</div>
        </div>
      )}

      {/* 没有更多 */}
      {!hasMore && sessions.length > 0 && (
        <div className="flex items-center justify-center py-4">
          <div className="text-xs text-text-tertiary">没有更多会话了</div>
        </div>
      )}
    </div>
  );
}
