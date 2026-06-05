import { create } from 'zustand';
import type { Session, SessionStatus } from '@/services/db';
import {
  sessionCreate,
  sessionBindWorkspace,
  sessionGet,
  sessionList,
  sessionUpdateTitle,
  sessionUpdateModelConfig,
  sessionDelete,
  sessionCount,
  sessionUpdateLastMessage,
} from '@/services/db';

const PAGE_SIZE = 5;

// ─── State Interface ──────────────────────────────────────────────

interface SessionState {
  // State
  sessions: Session[];
  activeSessionId: string | null;
  loading: boolean;
  hasMore: boolean;
  totalSessions: number;
  currentPage: number;

  // Actions
  createSession: (capabilityId?: string, capabilityName?: string) => Promise<Session>;
  loadSessions: (page?: number) => Promise<void>;
  loadMore: () => Promise<void>;
  setActiveSession: (id: string | null) => void;
  updateSessionTitle: (id: string, title: string) => Promise<void>;
  updateSessionModelConfig: (id: string, modelConfig: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  generateTitle: (sessionId: string, firstMessage: string) => Promise<void>;
  refreshSessionList: () => Promise<void>;
}

// ─── Store ────────────────────────────────────────────────────────

export const useSessionStore = create<SessionState>()((set, get) => ({
  // Initial state
  sessions: [],
  activeSessionId: null,
  loading: false,
  hasMore: true,
  totalSessions: 0,
  currentPage: 0,

  // ── Actions ────────────────────────────────────────────────────

  /**
   * 创建新会话
   *
   * **Workspace 联动逻辑（session-workspace-binding）**：
   * 1. 调用 `resolveWorkspaceNeeds(capabilityId)` 判断该能力是否需要 Workspace
   * 2. 如果 `needsWorkspace === true`：
   *    - 调用 `workspaceStore.createWorkspace(capabilityId)` 创建 Workspace
   *    - 调用 `sessionBindWorkspace(sessionId, workspace.id)` 持久化绑定到 DB
   *    - 调用 `workspaceStore.bindSession(sessionId, workspace.id)` 绑定到内存 map
   *    - 设置 `currentWorkspaceId = workspace.id`（文件树区域立即切换）
   * 3. 如果 `needsWorkspace === false`：
   *    - 调用 `workspaceStore.clearActive()`（文件树区域显示空状态）
   * 4. 如果 `capabilityId` 为空（纯闲聊会话）：跳过 Workspace 逻辑
   *
   * @param capabilityId - 能力 ID（可选，为空时创建纯闲聊会话）
   * @param capabilityName - 能力名称（可选，用于会话标题）
   * @returns 创建的 Session 对象
   *
   * Spec reference: openspec/changes/use_def/session-workspace-binding/design.md §D2
   */
  createSession: async (capabilityId?, capabilityName?) => {
    // Step 1: create session in DB (without workspace_id first)
    const sessionId = await sessionCreate(capabilityId, capabilityName);

    // Step 2: if capability needs workspace, create it and bind
    if (capabilityId) {
      try {
        const { resolveWorkspaceNeeds } = await import('@/platform/registry/capabilityResolver');
        const needsWorkspace = resolveWorkspaceNeeds(capabilityId);
        if (needsWorkspace) {
          const { useWorkspaceStore } = await import('@/stores/workspaceStore');
          const workspaceStore = useWorkspaceStore.getState();
          const workspace = await workspaceStore.createWorkspace(capabilityId);

          // Persist workspace_id to DB (so it survives app restart)
          await sessionBindWorkspace(sessionId, workspace.id);

          // Also bind in memory for current session
          workspaceStore.bindSession(sessionId, workspace.id);

          // Switch UI to this workspace
          useWorkspaceStore.setState({
            currentWorkspaceId: workspace.id,
            currentWorkspacePath: workspace.path,
            fileTree: [],
          });
        } else {
          // Pure chat session — clear active workspace in UI
          const { useWorkspaceStore } = await import('@/stores/workspaceStore');
          useWorkspaceStore.getState().clearActive();
        }
      } catch (err) {
        console.warn('[sessionStore] createSession: failed to resolve workspace needs', err);
      }
    }

    // Step 3: fetch full session from DB and update store
    const session = await sessionGet(sessionId);
    if (!session) {
      throw new Error(`Failed to create session: ${sessionId}`);
    }

    // Add to session list head
    set((state) => ({
      sessions: [session, ...state.sessions],
      activeSessionId: sessionId,
      totalSessions: state.totalSessions + 1,
    }));

    return session;
  },

  /**
   * 分页加载会话
   * @param page - 页码（从 1 开始），不传则加载第一页
   */
  loadSessions: async (page = 1) => {
    set({ loading: true });
    try {
      const result = await sessionList(page, PAGE_SIZE);
      
      set({
        sessions: page === 1 ? result.items : [...get().sessions, ...result.items],
        hasMore: result.items.length >= PAGE_SIZE,
        totalSessions: result.total,
        currentPage: page,
        loading: false,
      });
    } catch (error) {
      console.error('[sessionStore] loadSessions failed:', error);
      set({ loading: false });
      throw error;
    }
  },

  /**
   * 加载更多会话（下拉触发）
   */
  loadMore: async () => {
    const { hasMore, loading, currentPage } = get();
    if (!hasMore || loading) return;

    await get().loadSessions(currentPage + 1);
  },

  /**
   * 设置活跃会话
   *
   * **Workspace 联动逻辑（session-workspace-binding）**：
   * 1. 设置 `activeSessionId = id`
   * 2. 异步调用 `workspaceStore.switchToSession(id)`：
   *    - 如果 `sessionWorkspaceMap[id]` 存在：切换到对应 Workspace，文件树刷新
   *    - 如果 `sessionWorkspaceMap[id]` 不存在：调用 `clearActive()`，文件树显示空状态
   * 3. 如果 `id` 为 null：清空活跃会话，文件树显示空状态
   *
   * @param id - 会话 ID（传 null 表示清空活跃会话）
   *
   * Spec reference: openspec/changes/use_def/session-workspace-binding/design.md §D3
   */
  setActiveSession: (id) => {
    set({ activeSessionId: id });
    // 同步切换 Workspace（动态 import 避免循环依赖）
    import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
      useWorkspaceStore.getState().switchToSession(id ?? '');
    }).catch((err) => {
      console.error('[sessionStore] setActiveSession: workspace switch failed', err);
    });
  },

  /**
   * 更新会话标题
   */
  updateSessionTitle: async (id, title) => {
    await sessionUpdateTitle(id, title);
    
    // 更新本地状态
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, title } : s
      ),
    }));
  },

  /**
   * 更新会话的模型配置
   */
  updateSessionModelConfig: async (id, modelConfig) => {
    await sessionUpdateModelConfig(id, modelConfig);
  },

  /**
   * 删除会话（软删除）
   *
   * 同时解绑 Session 与 Workspace 的关联，防止 sessionWorkspaceMap 泄漏。
   *
   * Spec reference: openspec/changes/use_def/session-workspace-binding/design.md §D5
   */
  deleteSession: async (id) => {
    // 先解绑 Workspace 关联
    try {
      const { useWorkspaceStore } = await import('@/stores/workspaceStore');
      useWorkspaceStore.getState().unbindSession(id);
    } catch (err) {
      console.warn('[sessionStore] deleteSession: unbindSession failed', err);
    }

    await sessionDelete(id);
    
    // 更新本地状态
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
      totalSessions: state.totalSessions - 1,
    }));
  },

  /**
   * 调用 AI 生成会话标题
   * 根据第一条消息内容生成简洁的标题
   */
  generateTitle: async (sessionId, firstMessage) => {
    try {
      // 导入 AI 服务生成标题
      const { chatWithStream } = await import('@/services/agentService');
      const { useWorkspaceStore } = await import('@/stores/workspaceStore');
      
      const workspacePath = useWorkspaceStore.getState().currentWorkspacePath;
      if (!workspacePath) return;

      // 使用 assistant agent 生成标题
      let title = '';
      await chatWithStream(
        {
          sessionID: `title-gen-${Date.now()}`,
          message: `请为以下对话生成一个简短的标题（不超过20个字）：\n${firstMessage}\n\n只返回标题，不要有任何其他内容。`,
          capabilityId: 'assistant',
          workspacePath,
        },
        (event) => {
          if (event.type === 'text-delta') {
            title += event.text ?? '';
          }
        },
      );

      // 清理标题（移除可能的引号）
      title = title.trim().replace(/^[""''「「]|[""''」」]$/g, '');
      
      if (title) {
        await get().updateSessionTitle(sessionId, title);
      }
    } catch (error) {
      console.error('[sessionStore] generateTitle failed:', error);
      // 生成标题失败不影响主流程，使用默认标题
    }
  },

  /**
   * 刷新会话列表（重新从 DB 加载第一页）
   */
  refreshSessionList: async () => {
    set({ currentPage: 0, hasMore: true });
    await get().loadSessions(1);
  },
}));

// ─── Selectors ─────────────────────────────────────────────────────

export const useActiveSession = () =>
  useSessionStore((state) =>
    state.activeSessionId
      ? state.sessions.find((s) => s.id === state.activeSessionId) ?? null
      : null
  );

export const useSessions = () => useSessionStore((state) => state.sessions);
export const useSessionLoading = () => useSessionStore((state) => state.loading);
export const useHasMoreSessions = () => useSessionStore((state) => state.hasMore);
