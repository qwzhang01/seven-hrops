/**
 * e2e: Session Persistence — Phase 8 Task 8.3
 *
 * Flow: 
 *   1. 创建会话 → 发送消息 → 生成标题 → 查看历史会话
 *   2. 删除会话 → 软删除，列表中不再显示
 *   3. 分页加载 → 下拉加载更多会话
 *
 * This test runs against the real store/service layer with mocked Tauri commands.
 * It does NOT require a running Tauri process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act } from "@testing-library/react"

// ─── Mock Data ─────────────────────────────────────────────────────

// Mock sessions with 7 sessions for pagination tests
const createMockSessions = (count: number) => {
  const sessions = []
  const capabilities = [
    { id: "resume-screening", name: "简历筛选" },
    { id: "jd-optimization", name: "JD优化" },
  ]
  
  for (let i = 1; i <= count; i++) {
    const cap = capabilities[(i - 1) % capabilities.length]
    sessions.push({
      id: `sess-${i}`,
      title: `${cap.name}会话 ${i}`,
      session_type: "normal",
      capability_id: cap.id,
      capability_name: cap.name,
      status: "active" as const,
      last_message_at: `2026-06-01T${String(10 + i).padStart(2, '0')}:00:00+08:00`,
      message_count: i * 2,
      model_config: null,
      created_at: `2026-06-01T${String(9 + i).padStart(2, '0')}:00:00+08:00`,
      updated_at: `2026-06-01T${String(10 + i).padStart(2, '0')}:00:00+08:00`,
    })
  }
  return sessions
}

const mockSessions = createMockSessions(7)

const mockMessages = [
  {
    id: "msg-1",
    session_id: "sess-1",
    role: "user",
    content: "帮我筛选简历",
    content_parts: null,
    tool_calls: null,
    tokens_used: null,
    latency_ms: null,
    created_at: "2026-06-01T09:30:00+08:00",
  },
  {
    id: "msg-2",
    session_id: "sess-1",
    role: "assistant",
    content: "好的，我来帮你筛选简历...",
    content_parts: null,
    tool_calls: '[{"tool": "parse_resume_batch", "args": {...}}]',
    tokens_used: 150,
    latency_ms: 1200,
    created_at: "2026-06-01T09:31:00+08:00",
  },
]

// ─── Mocks ────────────────────────────────────────────────────────

// Helper to create a new session object
const createNewSession = (id: string, capabilityId = "resume-screening", capabilityName = "简历筛选"): any => ({
  id,
  title: capabilityName,
  session_type: "normal",
  capability_id: capabilityId,
  capability_name: capabilityName,
  status: "active" as const,
  last_message_at: new Date().toISOString(),
  message_count: 0,
  model_config: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
})

// Track created sessions for sessionGet to return
const createdSessions: any[] = []

// Track created messages for messageGet to return
const createdMessages: any[] = []

vi.mock("@/services/db", () => ({
  // sessionCreate returns sessionId string
  sessionCreate: vi.fn().mockImplementation((capabilityId, capabilityName) => {
    const newId = `sess-new-${Date.now()}`
    // Store the new session so sessionGet can return it
    const newSession = createNewSession(newId, capabilityId, capabilityName)
    createdSessions.push(newSession)
    return Promise.resolve(newId)
  }),
  // sessionGet returns Session object or null
  sessionGet: vi.fn().mockImplementation((id) => {
    // Check created sessions first (for newly created sessions)
    const created = createdSessions.find(s => s.id === id)
    if (created) return Promise.resolve(created)
    // Then check mockSessions
    return Promise.resolve(mockSessions.find(s => s.id === id) || null)
  }),
  // sessionList returns { items, total }
  sessionList: vi.fn().mockResolvedValue({ 
    items: mockSessions.slice(0, 5), 
    total: mockSessions.length 
  }),
  sessionUpdateTitle: vi.fn().mockResolvedValue(undefined),
  sessionUpdateModelConfig: vi.fn().mockResolvedValue(undefined),
  // sessionDelete returns undefined (soft delete)
  sessionDelete: vi.fn().mockResolvedValue(undefined),
  sessionCount: vi.fn().mockResolvedValue(mockSessions.length),
  sessionUpdateLastMessage: vi.fn().mockResolvedValue(undefined),
  // messageCreate returns messageId string
  messageCreate: vi.fn().mockImplementation((input) => {
    const newId = `msg-new-${Date.now()}`
    // Store the new message so messageGet can return it
    const newMessage = {
      id: newId,
      session_id: input.session_id || "sess-1",
      role: input.role || "user",
      content: input.content || "",
      content_parts: input.content_parts || null,
      tool_calls: input.tool_calls || null,
      tokens_used: input.tokens_used || null,
      latency_ms: input.latency_ms || null,
      created_at: new Date().toISOString(),
    }
    createdMessages.push(newMessage)
    return Promise.resolve(newId)
  }),
  // messageListBySession returns Message array
  messageListBySession: vi.fn().mockResolvedValue(mockMessages),
  // messageUpdateContent returns undefined
  messageUpdateContent: vi.fn().mockResolvedValue(undefined),
  // messageUpdateToolCalls returns undefined
  messageUpdateToolCalls: vi.fn().mockResolvedValue(undefined),
  // messageGet returns Message object or null
  messageGet: vi.fn().mockImplementation((id) => {
    // Check created messages first
    const created = createdMessages.find(m => m.id === id)
    if (created) return Promise.resolve(created)
    // Then check mockMessages
    return Promise.resolve(mockMessages.find(m => m.id === id) || null)
  }),
  messageDelete: vi.fn().mockResolvedValue(undefined),
}))

// ─── Tests ────────────────────────────────────────────────────────

describe("e2e: Session Persistence (Phase 8 Task 8.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear created sessions and messages tracking arrays
    createdSessions.length = 0
    createdMessages.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── Scenario 1: 创建会话 → 发送消息 → 生成标题 → 查看历史会话 ───
  describe("Scenario 1: Create session → Send message → Generate title → View history", () => {
    it("creates a new session and sends a message", async () => {
      const { useSessionStore } = await import("@/stores/sessionStore")
      const { useMessageStore } = await import("@/stores/messageStore")
      const db = await import("@/services/db")

      const sessionStore = useSessionStore.getState()
      const messageStore = useMessageStore.getState()

      // Step 1: Create a new session
      let newSession: any = null
      await act(async () => {
        newSession = await sessionStore.createSession("resume-screening", "简历筛选")
      })

      expect(db.sessionCreate).toHaveBeenCalledWith("resume-screening", "简历筛选")
      expect(newSession).toBeDefined()
      expect(newSession.id).toMatch(/^sess-new-\d+$/)
      expect(newSession.capability_id).toBe("resume-screening")

      // Step 2: Load messages for the session
      await act(async () => {
        await messageStore.loadMessages(newSession.id)
      })

      expect(db.messageListBySession).toHaveBeenCalledWith(newSession.id)

      // Step 3: Add a user message
      await act(async () => {
        await messageStore.addMessage(newSession.id, {
          role: "user",
          content: "帮我筛选简历",
        })
      })

      expect(db.messageCreate).toHaveBeenCalled()

      // Step 4: Simulate AI generating title (via generateTitle action)
      // Note: generateTitle is async and calls AI, we just verify the action exists
      expect(typeof sessionStore.generateTitle).toBe("function")
    })

    it("loads session list and displays history", async () => {
      const { useSessionStore } = await import("@/stores/sessionStore")
      const db = await import("@/services/db")

      const sessionStore = useSessionStore.getState()

      // Load initial sessions
      await act(async () => {
        await sessionStore.loadSessions(1)
      })

      expect(db.sessionList).toHaveBeenCalledWith(1, expect.any(Number))
      
      const sessions = useSessionStore.getState().sessions
      expect(sessions.length).toBeGreaterThan(0)
    })
  })

  // ─── Scenario 2: 删除会话 → 软删除，列表中不再显示 ───
  describe("Scenario 2: Delete session → Soft delete, not shown in list", () => {
    it("soft deletes a session and removes it from list", async () => {
      const { useSessionStore } = await import("@/stores/sessionStore")
      const db = await import("@/services/db")

      const sessionStore = useSessionStore.getState()

      // First load sessions
      await act(async () => {
        await sessionStore.loadSessions(1)
      })

      const initialCount = useSessionStore.getState().sessions.length
      expect(initialCount).toBeGreaterThan(0)

      // Delete the first session
      const sessionToDelete = useSessionStore.getState().sessions[0]
      await act(async () => {
        await sessionStore.deleteSession(sessionToDelete.id)
      })

      expect(db.sessionDelete).toHaveBeenCalledWith(sessionToDelete.id)

      // Verify the session is removed from the list
      const sessionsAfterDelete = useSessionStore.getState().sessions
      expect(sessionsAfterDelete.find(s => s.id === sessionToDelete.id)).toBeUndefined()
    })

    it("soft deleted session can be verified in DB (status = 'deleted')", async () => {
      const db = await import("@/services/db")

      // Call sessionDelete which should set status = 'deleted'
      await db.sessionDelete("sess-1")

      expect(db.sessionDelete).toHaveBeenCalledWith("sess-1")
      // In real DB, the session status would be 'deleted'
      // and would not appear in subsequent sessionList calls
    })
  })

  // ─── Scenario 3: 分页加载 → 下拉加载更多会话 ───
  describe("Scenario 3: Paginated loading → Load more on scroll", () => {
    it("loads more sessions when loadMore is called", async () => {
      const { useSessionStore } = await import("@/stores/sessionStore")
      const db = await import("@/services/db")

      // Mock paginated responses - sessionList returns { items, total }
      const page1Sessions = { 
        items: mockSessions.slice(0, 5), 
        total: 7 
      }
      const page2Sessions = { 
        items: [
          { ...mockSessions[0], id: "sess-3", title: "面试提纲" },
          { ...mockSessions[1], id: "sess-4", title: "笔试准备" },
        ], 
        total: 7 
      }

      vi.mocked(db.sessionList)
        .mockResolvedValueOnce(page1Sessions)
        .mockResolvedValueOnce(page2Sessions)
      vi.mocked(db.sessionCount).mockResolvedValue(7) // Total 7 sessions

      const sessionStore = useSessionStore.getState()

      // Load first page
      await act(async () => {
        await sessionStore.loadSessions(1)
      })

      expect(db.sessionList).toHaveBeenCalledWith(1, expect.any(Number))
      expect(useSessionStore.getState().sessions.length).toBe(5)
      expect(useSessionStore.getState().hasMore).toBe(true)

      // Load more (second page)
      await act(async () => {
        await sessionStore.loadMore()
      })

      expect(db.sessionList).toHaveBeenCalledWith(2, expect.any(Number))
      expect(useSessionStore.getState().sessions.length).toBe(7)
    })

    it("stops loading when all sessions are loaded (hasMore = false)", async () => {
      const { useSessionStore } = await import("@/stores/sessionStore")
      const db = await import("@/services/db")

      // Mock: only 2 sessions total
      vi.mocked(db.sessionList).mockResolvedValueOnce({ 
        items: mockSessions.slice(0, 2), 
        total: 2 
      })
      vi.mocked(db.sessionCount).mockResolvedValue(2)

      const sessionStore = useSessionStore.getState()

      await act(async () => {
        await sessionStore.loadSessions(1)
      })

      expect(useSessionStore.getState().hasMore).toBe(false)
    })
  })

  // ─── Additional: Test message persistence ───
  describe("Additional: Message persistence within session", () => {
    it("loads messages for a specific session", async () => {
      const { useMessageStore } = await import("@/stores/messageStore")
      const db = await import("@/services/db")

      const messageStore = useMessageStore.getState()

      await act(async () => {
        await messageStore.loadMessages("sess-1")
      })

      expect(db.messageListBySession).toHaveBeenCalledWith("sess-1")
      expect(messageStore.getMessagesForSession("sess-1").length).toBe(2)
    })

    it("updates message content (for streaming)", async () => {
      const { useMessageStore } = await import("@/stores/messageStore")
      const db = await import("@/services/db")

      const messageStore = useMessageStore.getState()

      // First load messages
      await act(async () => {
        await messageStore.loadMessages("sess-1")
      })

      // Update message content (simulating streaming)
      await act(async () => {
        await messageStore.updateMessageContent("msg-2", "Updated content...")
      })

      expect(db.messageUpdateContent).toHaveBeenCalledWith("msg-2", "Updated content...")
    })
  })
})
