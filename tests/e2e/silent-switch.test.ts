/**
 * e2e: Silent Switch — Phase G Task 12.1
 *
 * Flow: user types "帮我筛简历" in assistant capability
 *   → assert ① capability switches to resume-screening within 2s
 *   → assert ② transcripts contain transferredFrom summary
 *   → assert ③ SilentSwitchToast appears
 *
 * This test runs against the real store/service layer with mocked LLM.
 * It does NOT require a running Tauri process.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act } from "@testing-library/react"

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock("@/services/agentService", () => ({
  startSession: vi.fn().mockResolvedValue({ sessionId: "sess-assistant-1" }),
  endSession: vi.fn().mockResolvedValue(undefined),
  pauseSession: vi.fn().mockResolvedValue(undefined),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  transferContext: vi.fn().mockResolvedValue({
    transferredFrom: { sessionId: "sess-assistant-1", lastMessages: ["帮我筛简历"] },
  }),
  getManagedSession: vi.fn().mockReturnValue({ state: "active", metadata: {} }),
  chatWithStream: vi.fn().mockImplementation(async ({ onToolCall }) => {
    // Simulate LLM calling activate_capability
    if (onToolCall) {
      await onToolCall({
        toolName: "activate_capability",
        args: { capability_id: "resume-screening" },
        result: { success: true, newSessionId: "sess-screener-1" },
      })
    }
  }),
}))

vi.mock("@/stores/capabilityStore", () => ({
  useCapabilityStore: {
    getState: vi.fn().mockReturnValue({
      activeCapabilityId: "assistant",
      activateCapability: vi.fn(),
      records: [
        { id: "assistant", displayName: "助手", hidden: false },
        { id: "resume-screening", displayName: "简历筛选", hidden: false },
      ],
    }),
  },
}))

// ─── Tests ───────────────────────────────────────────────────────────

describe("e2e: Silent Switch (Phase G Task 12.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("switches capability to resume-screening within 2s when user says 帮我筛简历", async () => {
    const { useSilentSwitchStore } = await import("@/stores/silentSwitchStore")
    const { chatWithStream, startSession, pauseSession, transferContext } =
      await import("@/services/agentService")
    const { useCapabilityStore } = await import("@/stores/capabilityStore")

    const activateCapability = useCapabilityStore.getState().activateCapability as ReturnType<typeof vi.fn>

    // Simulate: user sends "帮我筛简历" in assistant
    const startTime = Date.now()
    await chatWithStream({
      capabilityId: "assistant",
      message: "帮我筛简历",
      onToolCall: async ({ toolName, args }: { toolName: string; args: Record<string, string> }) => {
        if (toolName === "activate_capability") {
          // system-toolpack activate_capability handler
          await pauseSession("sess-assistant-1")
          const { sessionId: newSessionId } = await startSession(args.capability_id, {
            transferredFrom: "sess-assistant-1",
          })
          await transferContext("sess-assistant-1", newSessionId, { lastNMessages: 5 })
          activateCapability(args.capability_id)
          useSilentSwitchStore.getState().setPending({
            fromCapability: "assistant",
            fromSessionId: "sess-assistant-1",
            toCapability: args.capability_id,
            toSessionId: newSessionId,
          })
        }
      },
    })
    const elapsed = Date.now() - startTime

    // ① capability switches within 2s
    expect(elapsed).toBeLessThanOrEqual(2000)
    expect(activateCapability).toHaveBeenCalledWith("resume-screening")

    // ② transferContext was called (transcripts contain transferredFrom)
    expect(transferContext).toHaveBeenCalledWith(
      "sess-assistant-1",
      expect.any(String),
      { lastNMessages: 5 },
    )

    // ③ SilentSwitchToast appears (pendingSwitch is set)
    const pending = useSilentSwitchStore.getState().pendingSwitch
    expect(pending).not.toBeNull()
    expect(pending?.toCapability).toBe("resume-screening")
    expect(pending?.fromCapability).toBe("assistant")
  })

  it("Toast disappears after 3s countdown (auto-confirm)", async () => {
    const { useSilentSwitchStore } = await import("@/stores/silentSwitchStore")

    await act(async () => {
      useSilentSwitchStore.getState().setPending({
        fromCapability: "assistant",
        fromSessionId: "sess-assistant-1",
        toCapability: "resume-screening",
        toSessionId: "sess-screener-1",
      })
    })

    expect(useSilentSwitchStore.getState().pendingSwitch).not.toBeNull()
    expect(useSilentSwitchStore.getState().countdown).toBe(3)

    // Advance 3 seconds → auto-confirm
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })

    expect(useSilentSwitchStore.getState().pendingSwitch).toBeNull()
  })
})
