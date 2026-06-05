import { create } from 'zustand';
import type { WorkspaceTask, WorkspaceTaskStatus, TaskType, TaskSchedule } from '@/types/workspace';
import type { Session } from '@/services/db';

// ─── State Interface ────────────────────────────────────────────

interface TaskState {
  tasks: WorkspaceTask[];
  activeTaskId: string | null;

  // Actions
  createTask: (params: {
    capabilityId: string;
    capabilityName: string;
    capabilityIcon: string;
    title: string;
    type?: TaskType;
    schedule?: TaskSchedule;
    workspaceId?: string;
    meta?: Record<string, unknown>;
    dependsOn?: string[];
  }) => Promise<WorkspaceTask>;

  updateTaskStatus: (taskId: string, status: WorkspaceTaskStatus, progress?: number) => void;
  setActiveTask: (taskId: string | null) => void;
  deleteTask: (taskId: string) => Promise<void>;
  bindWorkspace: (taskId: string, workspaceId: string) => void;
  getNextPendingTask: () => WorkspaceTask | null;
  canStartTask: (taskId: string) => boolean;
}

// ─── Store ─────────────────────────────────────────────────────
//
// 注意：任务即会话（Session），本 Store 仅作为兼容层存在。
// - 数据持久化由 DB 层（sessions 表）负责，不再使用 localStorage
// - createTask 实际创建的是 Session
// - 后续版本应直接迁移到 useSessionStore

export const useTaskStore = create<TaskState>()((set, get) => ({
  tasks: [],
  activeTaskId: null,

  createTask: async (params) => {
    const {
      capabilityId,
      capabilityName,
      // capabilityIcon is kept for UI compatibility, not stored in DB
      title,
      type = 'once',
      schedule,
      workspaceId,
      meta,
      dependsOn,
    } = params;

    // 实际创建会话（Session）
    const { sessionCreate, sessionUpdateTitle } = await import('@/services/db');
    const sessionId = await sessionCreate(capabilityId, capabilityName);
    
    if (title && title !== '新会话') {
      await sessionUpdateTitle(sessionId, title);
    }

    // 构造兼容的 WorkspaceTask 对象（内存中临时存在）
    const task: WorkspaceTask = {
      id: sessionId,
      capabilityId,
      capabilityName,
      capabilityIcon: '',
      title: title || '新会话',
      type,
      schedule,
      workspaceId,
      status: dependsOn && dependsOn.length > 0 ? 'waiting' : 'pending',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      meta,
      dependsOn,
    };

    set((state) => ({
      tasks: [task, ...state.tasks],
      activeTaskId: task.id,
    }));

    return task;
  },

  updateTaskStatus: (taskId, status, progress) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status,
              progress: progress ?? t.progress,
              updatedAt: Date.now(),
              startedAt: status === 'running' && !t.startedAt ? Date.now() : t.startedAt,
              completedAt: status === 'completed' ? Date.now() : t.completedAt,
            }
          : t
      ),
    }));

    // Unblock waiting tasks when a task completes
    if (status === 'completed') {
      const { tasks } = get();
      const completedIds = new Set(
        tasks
          .filter((t) => t.id === taskId || t.status === 'completed')
          .map((t) => t.id)
      );
      set((state) => ({
        tasks: state.tasks.map((t) => {
          if (
            t.status === 'waiting' &&
            t.dependsOn?.every((depId) => completedIds.has(depId))
          ) {
            return { ...t, status: 'pending', updatedAt: Date.now() };
          }
          return t;
        }),
      }));
    }
  },

  setActiveTask: (taskId) => set({ activeTaskId: taskId }),

  deleteTask: async (taskId) => {
    // 实际删除会话
    const { sessionDelete } = await import('@/services/db');
    await sessionDelete(taskId);

    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
      activeTaskId: state.activeTaskId === taskId ? null : state.activeTaskId,
    }));
  },

  bindWorkspace: (taskId, workspaceId) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, workspaceId, updatedAt: Date.now() } : t
      ),
    })),

  getNextPendingTask: () => {
    const { tasks } = get();
    return (
      tasks
        .filter((t) => t.status === 'pending')
        .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
    );
  },

  canStartTask: (taskId) => {
    const { tasks } = get();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return false;
    if (!task.dependsOn || task.dependsOn.length === 0) return true;
    const completedIds = new Set(
      tasks.filter((t) => t.status === 'completed').map((t) => t.id)
    );
    return task.dependsOn.every((depId) => completedIds.has(depId));
  },
}));
