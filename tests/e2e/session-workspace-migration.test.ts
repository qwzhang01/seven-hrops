/**
 * e2e: Session-Workspace Migration — session-workspace-binding Task 10.2
 *
 * Flow:
 *   1. 已有 Session（无 workspaceId 字段）→ 视为无 Workspace → 文件树显示空状态
 *   2. 已有 Workspace → 仍然可以正常使用 → 文件树显示 Workspace 目录
 *
 * This test verifies backward compatibility: old sessions without workspace_id
 * should gracefully degrade to the "no workspace" state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act } from "@testing-library/react"

// ─── Mock DB ─────────────────────────────────────────────────────

// Legacy session: no workspace_id field (pre-session-workspace-binding)
const legacySession = {
  id: "legacy-sess-1",
  title: "旧版简历筛选会话",
  session_type: "normal",
  capability_id: "resume-screening",
  capability_name: "简历筛选",
  status: "active" as const,
  last_message_at: "2026-05-01T10:00:00+08:00",
  message_count: 5,
  model_config: null,
  // workspace_id intentionally absent — legacy data
  created_at: "2026-05-01T09:00:00+08:00",
  updated_at: "2026-05-01T10:00:00+08:00",
}

// Modern session: has workspace_id field
const modernSession = {
  id: "modern-sess-1",
  title: "新版简历筛选会话",
  session_type: "normal",
  capability_id: "resume-screening",
  capability_name: "简历筛选",
  status: "active" as const,
  last_message_at: "2026-06-01T10:00:00+08:00",
  message_count: 3,
  model_config: null,
  workspace_id: "ws-modern-1",
  created_at: "2026-06-01T09:00:00+08:00",
  updated_at: "2026-06-01T10:00:00+08:00",
}

vi.mock("@/services/db", () => ({
  sessionCreate: vi.fn().mockResolvedValue("new-sess"),
  sessionGet: vi.fn().mockImplementation((id: string) => {
    if (id === "legacy-sess-1") return Promise.resolve(legacySession)
    if (id === "modern-sess-1") return Promise.resolve(modernSession)
    return Promise.resolve(null)
  }),
  sessionList: vi.fn().mockResolvedValue({
    items: [legacySession, modernSession],
    total: 2,
  }),
  sessionUpdateTitle: vi.fn().mockResolvedValue(undefined),
  sessionUpdateModelConfig: vi.fn().mockResolvedValue(undefined),
  sessionDelete: vi.fn().mockResolvedValue(undefined),
  sessionCount: vi.fn().mockResolvedValue(2),
  sessionUpdateLastMessage: vi.fn().mockResolvedValue(undefined),
  messageCreate: vi.fn().mockResolvedValue("msg-1"),
  messageListBySession: vi.fn().mockResolvedValue([]),
  messageUpdateContent: vi.fn().mockResolvedValue(undefined),
  messageUpdateToolCalls: vi.fn().mockResolvedValue(undefined),
  messageGet: vi.fn().mockResolvedValue(null),
  messageDelete: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/platform/registry/capabilityResolver", () => ({
  resolveWorkspaceNeeds: vi.fn().mockReturnValue(true),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "workspace_list_files") return Promise.resolve([])
    return Promise.resolve(null)
  }),
}))

// ─── Tests ────────────────────────────────────────────────────────

describe("e2e: Session-Workspace Migration (session-workspace-binding Task 10.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── Test Case 1: 旧 Session（无 workspace_id）→ 视为无 Workspace ──
  it("TC1: 旧 Session 无 workspace_id → setActiveSession → workspaceStore.clearActive()", async () => {
    const { useSessionStore } = await import("@/stores/sessionStore")
    const { useWorkspaceStore } = await import("@/stores/workspaceStore")

    // Setup: legacy session in store (no workspace binding)
    useSessionStore.setState({
      sessions: [legacySession] as any,
      activeSessionId: null,
      loading: false,
      hasMore: false,
      totalSessions: 1,
      currentPage: 1,
    })
    useWorkspaceStore.setState({
      workspaces: [],
      currentWorkspaceId: "some-old-ws",  // simulate stale state
      currentWorkspacePath: "/old/path",
      fileTree: [{ name: "stale.txt", path: "/old/stale.txt", type: "file" as const }],
      sessionWorkspaceMap: {},
    })

    // Switch to legacy session (no workspace binding in sessionWorkspaceMap)
    await act(async () => {
      useSessionStore.getState().setActiveSession("legacy-sess-1")
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(useSessionStore.getState().activeSessionId).toBe("legacy-sess-1")
    // Legacy session has no workspace binding → clearActive() should be called
    // → currentWorkspaceId should be null, fileTree should be cleared
    const wsState = useWorkspaceStore.getState()
    expect(wsState.currentWorkspaceId).toBeNull()
    expect(wsState.fileTree).toEqual([])
  })

  // ─── Test Case 2: 旧 Session 不报错，可以正常使用 ─────────────────
  it("TC2: 旧 Session 无 workspace_id → 不报错，可以正常发送消息", async () => {
    const { useSessionStore } = await import("@/stores/sessionStore")

    useSessionStore.setState({
      sessions: [legacySession] as any,
      activeSessionId: "legacy-sess-1",
      loading: false,
      hasMore: false,
      totalSessions: 1,
      currentPage: 1,
    })

    // Verify the session is accessible and has no workspace_id
    const session = useSessionStore.getState().sessions.find(s => s.id === "legacy-sess-1")
    expect(session).toBeDefined()
    expect((session as any).workspace_id).toBeUndefined()

    // setActiveSession should not throw for legacy sessions
    expect(() => {
      act(() => {
        useSessionStore.getState().setActiveSession("legacy-sess-1")
      })
    }).not.toThrow()
  })

  // ─── Test Case 3: 已有 Workspace → 正常显示文件树 ─────────────────
  it("TC3: 已有 Workspace 绑定的 Session → setActiveSession → workspaceStore 切换到对应 workspace", async () => {
    const { useSessionStore } = await import("@/stores/sessionStore")
    const { useWorkspaceStore } = await import("@/stores/workspaceStore")

    useSessionStore.setState({
      sessions: [modernSession] as any,
      activeSessionId: null,
      loading: false,
      hasMore: false,
      totalSessions: 1,
      currentPage: 1,
    })
    useWorkspaceStore.setState({
      workspaceList: [{ id: "ws-modern-1", path: "/workspaces/modern", name: "modern", capabilityId: "resume-screening", createdAt: Date.now() }],
      currentWorkspaceId: null,
      currentWorkspacePath: null,
      fileTree: [],
      sessionWorkspaceMap: { "modern-sess-1": "ws-modern-1" },
    })

    // Switch to modern session (has workspace binding)
    await act(async () => {
      useSessionStore.getState().setActiveSession("modern-sess-1")
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(useSessionStore.getState().activeSessionId).toBe("modern-sess-1")
    // Modern session has workspace binding → switchToSession() should be called
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-modern-1")
    expect(useWorkspaceStore.getState().currentWorkspacePath).toBe("/workspaces/modern")
  })

  // ─── Test Case 4: 混合场景 — 旧旧新新交替切换 ─────────────────────
  it("TC4: 旧新交替切换 → workspace 状态正确跟随", async () => {
    const { useSessionStore } = await import("@/stores/sessionStore")
    const { useWorkspaceStore } = await import("@/stores/workspaceStore")

    useSessionStore.setState({
      sessions: [legacySession, modernSession] as any,
      activeSessionId: null,
      loading: false,
      hasMore: false,
      totalSessions: 2,
      currentPage: 1,
    })
    useWorkspaceStore.setState({
      workspaceList: [{ id: "ws-modern-1", path: "/workspaces/modern", name: "modern", capabilityId: "resume-screening", createdAt: Date.now() }],
      currentWorkspaceId: null,
      currentWorkspacePath: null,
      fileTree: [],
      sessionWorkspaceMap: { "modern-sess-1": "ws-modern-1" },
    })

    // Switch to modern session → workspace should be set
    await act(async () => { 
      useSessionStore.getState().setActiveSession("modern-sess-1")
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-modern-1")

    // Switch to legacy session → workspace should be cleared
    await act(async () => { 
      useSessionStore.getState().setActiveSession("legacy-sess-1")
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBeNull()

    // Switch back to modern session → workspace should be restored
    await act(async () => { 
      useSessionStore.getState().setActiveSession("modern-sess-1")
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe("ws-modern-1")
  })
})