/**
 * Workspace Store — current workspace path and file tree.
 *
 * Design notes (Phase C):
 *   - Capability state → capabilityStore.ts
 *   - Music player state → musicStore.ts
 *   - Chat messages / isTyping / viewMode → Phase D (aiStore / layoutStore)
 *   - This store only manages: current workspace selection + file tree.
 */

import { create } from "zustand"
import type { FileTreeNode, ImportInputFilesResult, WorkspaceInfo } from "@/types/workspace"

// ─── State ───────────────────────────────────────────────────────────

interface WorkspaceState {
  currentWorkspaceId: string | null
  currentWorkspacePath: string | null
  fileTree: FileTreeNode[]
  workspaceList: WorkspaceInfo[]
  /**
   * Session → Workspace binding map.
   * Key: sessionId, Value: workspaceId
   *
   * Maintained in memory only (not persisted). When arch-session-db-persistence
   * lands, this will be persisted to the database.
   *
   * Spec reference: openspec/changes/use_def/session-workspace-binding/design.md §D5
   */
  sessionWorkspaceMap: Record<string, string>

  // Actions
  setCurrentWorkspace: (info: WorkspaceInfo | null) => void
  refreshFileTree: (workspaceId: string) => Promise<void>
  loadWorkspaces: () => Promise<void>
  createWorkspace: (capabilityId: string) => Promise<WorkspaceInfo>
  importInputFiles: (paths: string[], capabilityId: string) => Promise<ImportInputFilesResult>

  /**
   * Bind a session to a workspace.
   * Called by sessionStore.createSession when capability.needsWorkspace === true.
   */
  bindSession: (sessionId: string, workspaceId: string) => void
  /**
   * Unbind a session from its workspace.
   * Called by sessionStore.deleteSession to prevent map leaks.
   */
  unbindSession: (sessionId: string) => void
  /**
   * Look up the workspace bound to a session.
   * Returns undefined when the session has no workspace.
   */
  getWorkspaceBySession: (sessionId: string) => WorkspaceInfo | undefined
  /**
   * Switch the active workspace to the one bound to the given session.
   * If the session has no workspace, calls clearActive().
   *
   * This is the single entry point for workspace switching — called by
   * sessionStore.setActiveSession so UI components only need to react to
   * store state changes.
   */
  switchToSession: (sessionId: string) => void
  /**
   * Clear the active workspace (no workspace for current session).
   * Sets currentWorkspaceId/Path to null and empties the file tree.
   */
  clearActive: () => void
}

// ─── Store ───────────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  currentWorkspaceId: null,
  currentWorkspacePath: null,
  fileTree: [],
  workspaceList: [],
  sessionWorkspaceMap: {},

  setCurrentWorkspace: (info) =>
    set({
      currentWorkspaceId: info?.id ?? null,
      currentWorkspacePath: info?.path ?? null,
      fileTree: [],
    }),

  refreshFileTree: async (workspaceId) => {
    const { listFiles } = await import("@/services/workspaceManager")
    const nodes = await listFiles(workspaceId)
    set({ fileTree: nodes })
  },

  loadWorkspaces: async () => {
    const { listWorkspaces } = await import("@/services/workspaceManager")
    const list = await listWorkspaces()
    set({ workspaceList: list })
  },

  createWorkspace: async (capabilityId) => {
    const { createWorkspace } = await import("@/services/workspaceManager")
    const info = await createWorkspace(capabilityId)
    set((state) => ({
      workspaceList: [info, ...state.workspaceList],
      currentWorkspaceId: info.id,
      currentWorkspacePath: info.path,
    }))
    return info
  },
  importInputFiles: async (paths, capabilityId) => {
    const manager = await import("@/services/workspaceManager")
    let workspaceId = useWorkspaceStore.getState().currentWorkspaceId

    if (!workspaceId) {
      const info = await manager.createWorkspace(capabilityId)
      workspaceId = info.id
      set((state) => ({
        workspaceList: [info, ...state.workspaceList],
        currentWorkspaceId: info.id,
        currentWorkspacePath: info.path,
      }))
    }

    const result = await manager.importInputFiles(workspaceId, paths)
    const nodes = await manager.listFiles(workspaceId)
    set({ fileTree: nodes })
    return result
  },

  // ── Session-Workspace Binding ─────────────────────────────────────

  bindSession: (sessionId, workspaceId) => {
    set((state) => ({
      sessionWorkspaceMap: {
        ...state.sessionWorkspaceMap,
        [sessionId]: workspaceId,
      },
    }))
  },

  unbindSession: (sessionId) => {
    set((state) => {
      const next = { ...state.sessionWorkspaceMap }
      delete next[sessionId]
      return { sessionWorkspaceMap: next }
    })
  },

  getWorkspaceBySession: (sessionId) => {
    const { sessionWorkspaceMap, workspaceList } = get()
    const workspaceId = sessionWorkspaceMap[sessionId]
    if (!workspaceId) return undefined
    return workspaceList.find((w) => w.id === workspaceId)
  },

  switchToSession: (sessionId: string) => {
    // Step 1: try in-memory map first (fast path, no DB read)
    let workspace = get().getWorkspaceBySession(sessionId);

    // Step 2: if not in memory, try DB (handles app restart)
    if (!workspace) {
      // Read workspace_id from DB via sessionGet
      // We need to do this async, but switchToSession is sync.
      // Solution: do it in a microtask, and also update sessionWorkspaceMap.
      import('@/services/db').then(({ sessionGet }) => {
        sessionGet(sessionId).then((session) => {
          if (session?.workspace_id) {
            const ws = get().workspaceList.find((w) => w.id === session.workspace_id);
            if (ws) {
              get().bindSession(sessionId, ws.id);
              set({
                currentWorkspaceId: ws.id,
                currentWorkspacePath: ws.path,
                fileTree: [],
              });
              get().refreshFileTree(ws.id).catch((err) => {
                console.error('[workspaceStore] switchToSession: refreshFileTree failed', err);
              });
            }
          } else {
            get().clearActive();
          }
        }).catch((err) => {
          console.error('[workspaceStore] switchToSession: sessionGet failed', err);
        });
      });
      // Set empty state immediately (will be updated by the async path above)
      set({ currentWorkspaceId: null, currentWorkspacePath: null, fileTree: [] });
      return;
    }

    // Found in memory — switch immediately
    set({
      currentWorkspaceId: workspace.id,
      currentWorkspacePath: workspace.path,
      fileTree: [],
    });
    // Async: load file tree after switching
    get().refreshFileTree(workspace.id).catch((err) => {
      console.error("[workspaceStore] switchToSession: refreshFileTree failed", err);
    });
  },

  clearActive: () => {
    set({
      currentWorkspaceId: null,
      currentWorkspacePath: null,
      fileTree: [],
    })
  },
}))
