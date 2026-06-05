/**
 * orchestratorBridge unit tests — Phase G Task 6.5
 *
 * Covers:
 *   - handleInbound happy path: creates a fresh session per message
 *   - handleInbound repeated messages: two independent sessions
 *   - handleInbound timeout: session force-ended after timeout
 *   - pushOutbound: calls chatWithStream with orchestrator capabilityId
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  handleInbound,
  pushOutbound,
  clearActiveSessionsForTest,
} from "../orchestratorBridge"
import * as agentService from "../agentService"
import type { WebhookPayload } from "@/types/orchestrator"

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock("../agentService", async (importOriginal) => {
  const actual = await importOriginal<typeof agentService>()
  return {
    ...actual,
    startSession: vi.fn().mockImplementation(async (agentName: string) => ({
      sessionId: `mock-session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      agentName,
    })),
    endSession: vi.fn().mockResolvedValue(undefined),
    getManagedSession: vi.fn().mockReturnValue({ state: "active" }),
    chatWithStream: vi.fn().mockResolvedValue(undefined),
    clearManagedSessionsForTest: actual.clearManagedSessionsForTest,
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────

const makePayload = (overrides: Partial<WebhookPayload> = {}): WebhookPayload => ({
  fromUserId: "user-001",
  content: "我今天有几个待办",
  msgType: "text",
  msgId: "msg-001",
  receivedAt: Date.now(),
  ...overrides,
})

// ─── Tests ───────────────────────────────────────────────────────────

describe("orchestratorBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearActiveSessionsForTest()
    agentService.clearManagedSessionsForTest()
  })

  afterEach(() => {
    clearActiveSessionsForTest()
  })

  describe("handleInbound", () => {
    it("happy path: creates a session and calls chatWithStream", async () => {
      const payload = makePayload()
      await handleInbound(payload)

      expect(agentService.startSession).toHaveBeenCalledOnce()
      expect(agentService.startSession).toHaveBeenCalledWith(
        "orchestrator",
        expect.objectContaining({
          metadata: expect.objectContaining({
            wecomUserId: "user-001",
            parentSessionId: null,
            delegateDepth: 0,
          }),
        }),
      )
      expect(agentService.chatWithStream).toHaveBeenCalledOnce()
      expect(agentService.chatWithStream).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "我今天有几个待办",
          capabilityId: "orchestrator",
        }),
        expect.any(Function),
      )
    })

    it("repeated messages: two independent sessions created", async () => {
      const payload1 = makePayload({ content: "第一条消息", msgId: "msg-001" })
      const payload2 = makePayload({ content: "第二条消息", msgId: "msg-002" })

      await Promise.all([handleInbound(payload1), handleInbound(payload2)])

      // Two separate startSession calls
      expect(agentService.startSession).toHaveBeenCalledTimes(2)
      // Two separate chatWithStream calls
      expect(agentService.chatWithStream).toHaveBeenCalledTimes(2)

      // Each call has different content
      const calls = vi.mocked(agentService.chatWithStream).mock.calls
      const messages = calls.map((c) => (c[0] as { message: string }).message)
      expect(messages).toContain("第一条消息")
      expect(messages).toContain("第二条消息")
    })

    it("timeout: session is force-ended after timeout", async () => {
      vi.useFakeTimers()

      // Make chatWithStream hang indefinitely to simulate a long-running session
      vi.mocked(agentService.chatWithStream).mockImplementation(
        () => new Promise(() => {}), // never resolves
      )
      // getManagedSession returns active state so timeout fires endSession
      vi.mocked(agentService.getManagedSession).mockReturnValue({
        sessionId: "mock-session",
        agentName: "orchestrator",
        state: "active",
        metadata: { parentSessionId: null, delegateDepth: 0, transferredFrom: null },
        transcripts: [],
      })

      const payload = makePayload({ fromUserId: "timeout-user" })
      const handlePromise = handleInbound(payload)

      // Advance time past the 30s timeout
      await vi.advanceTimersByTimeAsync(31_000)

      // endSession should have been called with 'timeout' reason
      expect(agentService.endSession).toHaveBeenCalledWith(
        expect.any(String),
        "timeout",
      )

      vi.useRealTimers()
      // Clean up the hanging promise
      handlePromise.catch(() => undefined)
    })
  })

  describe("pushOutbound", () => {
    it("calls chatWithStream with orchestrator capabilityId and correct message", async () => {
      await pushOutbound("user-001", "你有 3 个待办任务")

      expect(agentService.startSession).toHaveBeenCalledWith(
        "orchestrator",
        expect.objectContaining({
          metadata: expect.objectContaining({ wecomUserId: "user-001" }),
        }),
      )
      expect(agentService.chatWithStream).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilityId: "orchestrator",
          message: expect.stringContaining("你有 3 个待办任务"),
        }),
        expect.any(Function),
      )
      // Session should be ended after push
      expect(agentService.endSession).toHaveBeenCalledOnce()
    })
  })
})
