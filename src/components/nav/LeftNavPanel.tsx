import { useState, useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { NavItem } from '@/components/common/NavItem';
import { UserMenuPopover } from './UserMenuPopover';
import { useLayoutStore } from '@/stores/layoutStore';
import { useTaskStore } from '@/stores/taskStore';
import { useSessionStore } from '@/stores/sessionStore';
import type { NavItemId } from '@/types/workspace';

interface LeftNavPanelProps {
  onOpenSettings?: () => void;
  onOpenLLMConfig?: () => void;
  onOpenWhitelist?: () => void;
}

/**
 * LeftNavPanel — v3.1 left navigation panel.
 * Sections (top to bottom):
 *   1. Logo area (drag region)
 *   2. Search box
 *   3. New task button
 *   4. Feature nav items (Browser, Email, IM)
 *   5. Session list (Phase 6)
 *   6. Workspace list
 *   7. Bottom user info area
 */
export function LeftNavPanel({ onOpenSettings, onOpenLLMConfig, onOpenWhitelist }: LeftNavPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);

  const { activeNavItem, isLeftPanelCollapsed, setActiveNavItem, openContentViewer, toggleLeftPanel } =
    useLayoutStore(
      useShallow((s) => ({
        activeNavItem: s.activeNavItem,
        isLeftPanelCollapsed: s.isLeftPanelCollapsed,
        setActiveNavItem: s.setActiveNavItem,
        openContentViewer: s.openContentViewer,
        toggleLeftPanel: s.toggleLeftPanel,
      }))
    );

  // Phase 6: Session Store
  const {
    sessions,
    activeSessionId,
    loadMore,
    hasMore,
    loading,
    setActiveSession,
    deleteSession,
    refreshSessionList,
  } = useSessionStore(
    useShallow((s) => ({
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      loadMore: s.loadMore,
      hasMore: s.hasMore,
      loading: s.loading,
      setActiveSession: s.setActiveSession,
      deleteSession: s.deleteSession,
      refreshSessionList: s.refreshSessionList,
    }))
  );

  const { tasks, activeTaskId, setActiveTask } = useTaskStore(
    useShallow((s) => ({
      tasks: s.tasks,
      activeTaskId: s.activeTaskId,
      setActiveTask: s.setActiveTask,
    }))
  );

  // Initial load sessions
  useEffect(() => {
    refreshSessionList();
  }, [refreshSessionList]);

  // Filter tasks by search query
  const filteredTasks = searchQuery
    ? tasks.filter((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : tasks.slice(0, 8);

  const handleNavClick = useCallback(
    (item: NavItemId, tabType: 'browser' | 'email' | 'im') => {
      setActiveNavItem(item);
      const totalWidth = window.innerWidth;
      if (tabType === 'browser') {
        openContentViewer({ id: 'browser', type: 'browser', title: '🌐 浏览器' }, totalWidth);
      } else if (tabType === 'email') {
        openContentViewer({ id: 'email', type: 'email', title: '📧 邮箱' }, totalWidth);
      }
    },
    [setActiveNavItem, openContentViewer]
  );

  const handleNewTask = useCallback(async () => {
    setActiveNavItem(null);
    // 新建一个空会话，并自动设为活跃会话
    const session = await useSessionStore.getState().createSession();
    useSessionStore.getState().setActiveSession(session.id);
  }, [setActiveNavItem]);

  // Handle session click
  const handleSessionClick = useCallback((sessionId: string) => {
    setActiveSession(sessionId);
  }, [setActiveSession]);

  // Handle session delete
  const handleSessionDelete = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定要删除这个会话吗？')) {
      await deleteSession(sessionId);
    }
  }, [deleteSession]);

  const collapsed = isLeftPanelCollapsed;

  // Format time for session display
  const formatSessionTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <div
      className="flex h-full flex-col bg-slate-deep"
      data-tauri-drag-region
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* ── Traffic lights spacer (titleBarStyle=Overlay, ~28px) ── */}
      {/* This empty area lets macOS render the red/yellow/green dots */}
      <div
        data-tauri-drag-region
        style={{ height: 28, WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* ── 1. Logo Area ── */}
      {collapsed ? (
        /* Collapsed: Logo centered, expand button below */
        <div
          data-tauri-drag-region
          className="flex shrink-0 flex-col items-center pb-2"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          {/* Logo icon */}
          <div
            data-tauri-drag-region
            className="flex items-center justify-center"
            style={{ height: 60, WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <img
              src="/logo-white.png"
              alt="Seven HROps"
              className="shrink-0 rounded-xl object-cover shadow-glow"
              style={{ width: 36, height: 36 }}
              draggable={false}
            />
          </div>
          {/* Expand button — below logo, full width */}
          <button
            onClick={toggleLeftPanel}
            className="flex w-full items-center justify-center py-1.5 text-text-tertiary transition-colors hover:text-text-secondary"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            aria-label="展开侧边栏"
            title="展开侧边栏"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      ) : (
        /* Expanded: Logo + name + collapse button in one row */
        <div
          data-tauri-drag-region
          className="flex shrink-0 items-center px-4"
          style={{
            WebkitAppRegion: 'drag',
            height: 60,
            gap: 10,
          } as React.CSSProperties}
        >
          {/* Logo icon */}
          <img
            src="/logo-white.png"
            alt="Seven HROps"
            className="shrink-0 rounded-xl object-cover shadow-glow"
            style={{ width: 36, height: 36 }}
            draggable={false}
          />
          {/* Name + version */}
          <div className="flex-1 overflow-hidden">
            <div className="truncate font-bold text-text-primary" style={{ fontSize: 17 }}>
              Seven HROps
            </div>
            <div className="text-[11px] text-text-tertiary">v0.1.0</div>
          </div>
          {/* Collapse button */}
          <button
            onClick={toggleLeftPanel}
            className="shrink-0 rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-edge hover:text-text-secondary"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            aria-label="折叠侧边栏"
            title="折叠侧边栏"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}

      {/* ── 2. Search Box ── */}
      {!collapsed && (
        <div
          className="relative px-4 pb-3"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </span>
            <input
              type="text"
              placeholder="搜索..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchResults(e.target.value.length > 0);
              }}
              onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
              className="h-10 w-full rounded-xl border border-edge bg-slate-raised pl-9 pr-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Search results dropdown */}
          {showSearchResults && (
            <div className="absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-xl border border-edge bg-slate-raised shadow-lg animate-float-in">
              {filteredTasks.length > 0 && (
                <div>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                    任务
                  </div>
                  {filteredTasks.slice(0, 4).map((task) => (
                    <button
                      key={task.id}
                      onClick={() => {
                        setActiveTask(task.id);
                        setSearchQuery('');
                        setShowSearchResults(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-edge hover:text-text-primary"
                    >
                      <span>{task.capabilityIcon}</span>
                      <span className="truncate">{task.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 3. New Task Button ── */}
      <div
        className={collapsed ? 'px-3 pb-3' : 'px-4 pb-3'}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={handleNewTask}
          className={[
            'flex w-full items-center gap-3 rounded-lg py-2.5 text-sm font-medium text-text-secondary',
            collapsed ? 'justify-center' : 'px-3',
            'transition-all hover:bg-slate-raised hover:text-text-primary',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          ].join(' ')}
          title={collapsed ? '新建对话' : undefined}
        >
          {/* Plus icon — SVG, not emoji */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {!collapsed && <span>新建对话</span>}
        </button>
      </div>

      {/* ── Scrollable content ── */}
      <div
        className="flex-1 overflow-y-auto scroll-soft px-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* ── 4. Feature Nav Items ── */}
        <div className="mb-1">
          {!collapsed && (
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              功能
            </div>
          )}
          <NavItem
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M2 9h14M9 2c-2 2-3 4.5-3 7s1 5 3 7M9 2c2 2 3 4.5 3 7s-1 5-3 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            }
            label="浏览器"
            isActive={activeNavItem === 'browser'}
            onClick={() => handleNavClick('browser', 'browser')}
            collapsed={collapsed}
          />
          <NavItem
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="4" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M2 6.5l7 4.5 7-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            }
            label="邮箱"
            isActive={activeNavItem === 'email'}
            onClick={() => handleNavClick('email', 'email')}
            collapsed={collapsed}
          />
          <NavItem
            icon={
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 3h12a1 1 0 011 1v7a1 1 0 01-1 1H6l-3 3V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
              </svg>
            }
            label="企业微信"
            isActive={activeNavItem === 'im'}
            onClick={() => setActiveNavItem('im')}
            collapsed={collapsed}
          />
        </div>

        {/* ── 5. Session List (Phase 6) ── */}
        {!collapsed && (
          <div className="mb-1 mt-2">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                对话
              </span>
              {/* Refresh button */}
              <button
                onClick={() => refreshSessionList()}
                className="rounded p-0.5 text-text-tertiary transition-colors hover:bg-edge hover:text-text-secondary"
                title="刷新会话列表"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2 6a5 5 0 119 3M2 6l2-2M2 6l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            
            {/* Session list */}
            <div className="space-y-0.5">
              {sessions.length === 0 && !loading ? (
                <div className="px-3 py-2 text-center text-[11px] text-text-tertiary">
                  暂无会话
                </div>
              ) : (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => handleSessionClick(session.id)}
                    className={[
                      'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                      session.id === activeSessionId
                        ? 'bg-primary/10 text-text-primary'
                        : 'text-text-secondary hover:bg-slate-raised hover:text-text-primary',
                    ].join(' ')}
                  >
                    {/* Capability icon (if any) */}
                    {session.capability_id && (
                      <span className="shrink-0 text-[10px]">🤖</span>
                    )}
                    
                    {/* Session title */}
                    <span className="flex-1 truncate">{session.title}</span>
                    
                    {/* Time */}
                    <span className="shrink-0 text-[10px] text-text-tertiary">
                      {formatSessionTime(session.last_message_at ?? session.created_at)}
                    </span>
                    
                    {/* Delete button */}
                    <span
                      onClick={(e) => handleSessionDelete(session.id, e)}
                      className="shrink-0 rounded p-0.5 text-text-tertiary opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                      title="删除会话"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                    </span>
                  </button>
                ))
              )}
              
              {/* Load more button */}
              {hasMore && sessions.length > 0 && (
                <button
                  onClick={() => loadMore()}
                  className="flex w-full items-center justify-center px-3 py-1 text-[10px] text-text-tertiary transition-colors hover:text-text-secondary"
                  disabled={loading}
                >
                  {loading ? '加载中...' : '加载更多'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── 6. Task List (kept for compatibility) ── */}
        {!collapsed && tasks.length > 0 && (
          <div className="mb-1 mt-2">
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              任务
            </div>
            {tasks.slice(0, 5).map((task) => (
              <button
                key={task.id}
                onClick={() => setActiveTask(task.id)}
                className={[
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                  activeTaskId === task.id
                    ? 'bg-primary/10 text-text-primary'
                    : 'text-text-secondary hover:bg-slate-raised hover:text-text-primary',
                ].join(' ')}
              >
                <span className="shrink-0 text-[10px]">{task.capabilityIcon}</span>
                <span className="flex-1 truncate">{task.title}</span>
              </button>
            ))}
          </div>
        )}

      </div>

      {/* ── 7. Bottom User Info ── */}
      <div
        className="shrink-0 border-t border-edge p-3"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {collapsed ? (
          <button
            className="flex w-full items-center justify-center rounded-xl p-2 transition-colors hover:bg-slate-raised"
            title="用户菜单"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full overflow-hidden bg-primary/10">
              <img
                src="/logo-white.png"
                alt="用户菜单"
                className="h-7 w-7 shrink-0 object-contain"
                style={{ mixBlendMode: 'screen' }}
                draggable={false}
              />
            </div>
          </button>
        ) : (
          <UserMenuPopover
            onOpenSettings={onOpenSettings}
            onOpenLLMConfig={onOpenLLMConfig}
            onOpenWhitelist={onOpenWhitelist}
          />
        )}
      </div>
    </div>
  );
}
