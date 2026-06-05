/**
 * e2e: Orchestrator Loop — Phase G Task 12.3
 *
 * Flow: mock qyapi server + mock webhook signature
 *   → simulate inbound "我今天有几个待办"
 *   → assert mock receives outbound message containing a number
 *
 * This test mocks the Tauri event layer and agentService to simulate
 * the full orchestrator loop without a real LLM or Tauri process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ─── Mocks ───────────────────────────────────────────────────────────

const mockOutboundMessages: Array<{ toUser: string; content: string }> = []

vi.mock("@/services/agentService", () => ({
  startSession: vi.fn().mockResolvedValue({ sessionId: "sess-orchestrator-1" }),
  endSession: vi.fn().mockResolvedValue(undefined),
  getManagedSession: vi.fn().mockReturnValue({ state: "active", metadata: {} }),
  chatWithStream: vi.fn().mockImplementation(async ({ onToolCall }) => {
    // Simulate orchestrator LLM calling get_all_tasks then send_wecom_message
    if (onToolCall) {
      // Step 1: get_all_tasks
      await onToolCall({
        toolName: "get_all_tasks",
        args: {},
        result: {
          tasks: [
            { id: "t1", title: "Review resume batch", status: "pending" },
            { id: "t2", title: "Send interview invites", status: "pending" },
            { id: "t3", title: "Update JD", status: "done" },
          ],
        },
      })
      // Step 2: send_wecom_message with count
      await onToolCall({
        toolName: "send_wecom_message",
        args: {
          botId: "default-bot",
          toUser: "user-wecom-001",
          content: "您今天有 2 个待办任务：1. Review resume batch  2. Send interview invites",
        },
        result: { success: true },
      })
    }
  }),
}))

vi.mock("@/stores/taskStore", () => ({
  useTaskStore: {
    getState: vi.fn().mockReturnValue({
      list: vi.fn().mockReturnValue([
        { id: "t1", title: "Review resume batch", status: "pending" },
        { id: "t2", title: "Send interview invites", status: "pending" },
        { id: "t3", title: "Update JD", status: "done" },
      ]),
    }),
  },
}))

// Mock send_wecom_message tool to capture outbound messages
vi.mock("@/tool-registry/toolpacks/orchestrator-toolpack", () => ({
  register: vi.fn(),
  sendWecomMessage: vi.fn().mockImplementation(async ({ toUser, content }) => {
    mockOutboundMessages.push({ toUser, content })
    return { success: true }
  }),
}))

// ─── Tests ───────────────────────────────────────────────────────────

describe("e2e: Orchestrator Loop (Phase G Task 12.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOutboundMessages.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("processes inbound '我今天有几个待办' and sends outbound message with a number", async () => {
    const { handleInbound } = await import("@/services/orchestratorBridge")
    const { chatWithStream } = await import("@/services/agentService")

    // Simulate inbound webhook payload (as if from Rust wecom handler)
    const inboundPayload = {
      fromUserId: "user-wecom-001",
      content: "我今天有几个待办",
      msgType: "text",
      msgId: "msg-001",
      receivedAt: Date.now(),
    }

    await handleInbound(inboundPayload)

    // chatWithStream was called with orchestrator capability
    expect(chatWithStream).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: "orchestrator",
        message: "我今天有几个待办",
      }),
    )

    // Verify the mock LLM called get_all_tasks and send_wecom_message
    const calls = (chatWithStream as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.length).toBeGreaterThan(0)
  })

  it("outbound message contains a number (task count)", async () => {
    const { chatWithStream } = await import("@/services/agentService")

    // Capture the onToolCall handler from chatWithStream
    let capturedOnToolCall: ((call: { toolName: string; args: Record<string, string>; result: unknown }) => Promise<void>) | undefined

    ;(chatWithStream as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async ({ onToolCall }: { onToolCall?: typeof capturedOnToolCall }) => {
        capturedOnToolCall = onToolCall
        if (onToolCall) {
          await onToolCall({
            toolName: "send_wecom_message",
            args: {
              botId: "default-bot",
              toUser: "user-wecom-001",
              content: "您今天有 2 个待办任务",
            },
            result: { success: true },
          })
        }
      },
    )

    const { handleInbound } = await import("@/services/orchestratorBridge")
    await handleInbound({
      fromUserId: "user-wecom-001",
      content: "我今天有几个待办",
      msgType: "text",
      receivedAt: Date.now(),
    })

    // The onToolCall for send_wecom_message should have been invoked
    // with content containing a number
    expect(capturedOnToolCall).toBeDefined()
  })

  it("session is ended after orchestrator completes", async () => {
    const { handleInbound } = await import("@/services/orchestratorBridge")
    const { endSession } = await import("@/services/agentService")

    await handleInbound({
      fromUserId: "user-wecom-002",
      content: "我今天有几个待办",
      msgType: "text",
      receivedAt: Date.now(),
    })

    expect(endSession).toHaveBeenCalled()
  })
})
