/**
 * e2e: Silent Switch Undo — Phase G Task 12.2
 *
 * Flow: capability switch happens → user clicks undo within 1s
 *   → assert ① capability reverts to original
 *   → assert ② original session is resumed
 *   → assert ③ new session is ended
 *   → assert ④ Toast disappears
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act } from "@testing-library/react"

// ─── Mocks ───────────────────────────────────────────────────────────

const mockActivateCapability = vi.fn()
const mockResumeSession = vi.fn().mockResolvedValue(undefined)
const mockEndSession = vi.fn().mockResolvedValue(undefined)

vi.mock("@/stores/capabilityStore", () => ({
  useCapabilityStore: {
    getState: vi.fn().mockReturnValue({
      activeCapabilityId: "resume-screening",
      activateCapability: mockActivateCapability,
      records: [
        { id: "assistant", displayName: "助手", hidden: false },
        { id: "resume-screening", displayName: "简历筛选", hidden: false },
      ],
    }),
  },
}))

vi.mock("@/services/agentService", () => ({
  startSession: vi.fn().mockResolvedValue({ sessionId: "sess-screener-1" }),
  endSession: mockEndSession,
  pauseSession: vi.fn().mockResolvedValue(undefined),
  resumeSession: mockResumeSession,
  transferContext: vi.fn().mockResolvedValue(undefined),
  getManagedSession: vi.fn().mockReturnValue({ state: "paused", metadata: {} }),
  chatWithStream: vi.fn().mockResolvedValue(undefined),
}))

// ─── Tests ───────────────────────────────────────────────────────────

describe("e2e: Silent Switch Undo (Phase G Task 12.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("reverts capability and resumes original session when undo is clicked within 1s", async () => {
    const { useSilentSwitchStore } = await import("@/stores/silentSwitchStore")

    // Setup: a pending switch exists (assistant → resume-screening)
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

    // Simulate: user clicks undo within 1s
    await act(async () => {
      vi.advanceTimersByTime(800) // 0.8s — still within window
    })

    await act(async () => {
      await useSilentSwitchStore.getState().undo()
    })

    // ① capability reverts to original
    expect(mockActivateCapability).toHaveBeenCalledWith("assistant")

    // ② original session is resumed
    expect(mockResumeSession).toHaveBeenCalledWith("sess-assistant-1")

    // ③ new session is ended
    expect(mockEndSession).toHaveBeenCalledWith("sess-screener-1")

    // ④ Toast disappears (pendingSwitch cleared)
    expect(useSilentSwitchStore.getState().pendingSwitch).toBeNull()
    expect(useSilentSwitchStore.getState().countdown).toBe(0)
  })

  it("undo is no-op when no pending switch exists", async () => {
    const { useSilentSwitchStore } = await import("@/stores/silentSwitchStore")

    // Ensure clean state
    useSilentSwitchStore.getState().clear()

    await act(async () => {
      await useSilentSwitchStore.getState().undo()
    })

    expect(mockActivateCapability).not.toHaveBeenCalled()
    expect(mockResumeSession).not.toHaveBeenCalled()
    expect(mockEndSession).not.toHaveBeenCalled()
  })

  it("auto-confirm prevents undo after 3s", async () => {
    const { useSilentSwitchStore } = await import("@/stores/silentSwitchStore")

    await act(async () => {
      useSilentSwitchStore.getState().setPending({
        fromCapability: "assistant",
        fromSessionId: "sess-assistant-1",
        toCapability: "resume-screening",
        toSessionId: "sess-screener-1",
      })
    })

    // Advance past the 3s window
    await act(async () => {
      vi.advanceTimersByTime(3100)
    })

    // pendingSwitch is now null (auto-confirmed)
    expect(useSilentSwitchStore.getState().pendingSwitch).toBeNull()

    // Undo after confirm is a no-op
    await act(async () => {
      await useSilentSwitchStore.getState().undo()
    })

    expect(mockActivateCapability).not.toHaveBeenCalled()
  })
})
