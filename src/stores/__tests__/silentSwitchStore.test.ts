/**
 * silentSwitchStore unit tests — Phase G Task 9.6
 *
 * Covers:
 *   - setPending: sets pendingSwitch state and starts countdown
 *   - confirm: clears pendingSwitch state
 *   - undo: restores original capability + session, ends new session
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useSilentSwitchStore } from "../silentSwitchStore"
import type { PendingSwitchInfo } from "../silentSwitchStore"

// ─── Mocks ───────────────────────────────────────────────────────────

const mockActivateCapability = vi.fn()
const mockResumeSession = vi.fn().mockResolvedValue(undefined)
const mockEndSession = vi.fn().mockResolvedValue(undefined)

vi.mock("@/stores/capabilityStore", () => ({
  useCapabilityStore: {
    getState: () => ({
      activateCapability: mockActivateCapability,
    }),
  },
}))

vi.mock("@/services/agentService", () => ({
  resumeSession: mockResumeSession,
  endSession: mockEndSession,
}))

// ─── Helpers ─────────────────────────────────────────────────────────

const makePendingInfo = (overrides: Partial<PendingSwitchInfo> = {}): PendingSwitchInfo => ({
  fromCapability: "assistant",
  fromSessionId: "session-from-001",
  toCapability: "resume-screening",
  toSessionId: "session-to-001",
  ...overrides,
})

// ─── Tests ───────────────────────────────────────────────────────────

describe("silentSwitchStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Reset store state
    act(() => {
      useSilentSwitchStore.getState().clear()
    })
  })

  afterEach(() => {
    act(() => {
      useSilentSwitchStore.getState().clear()
    })
    vi.useRealTimers()
  })

  describe("setPending", () => {
    it("sets pendingSwitch and starts countdown at 3", () => {
      const info = makePendingInfo()
      act(() => {
        useSilentSwitchStore.getState().setPending(info)
      })

      const state = useSilentSwitchStore.getState()
      expect(state.pendingSwitch).toEqual(info)
      expect(state.countdown).toBe(3)
    })

    it("countdown decrements each second", async () => {
      act(() => {
        useSilentSwitchStore.getState().setPending(makePendingInfo())
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(useSilentSwitchStore.getState().countdown).toBe(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(useSilentSwitchStore.getState().countdown).toBe(1)
    })

    it("auto-confirms after 3 seconds", async () => {
      act(() => {
        useSilentSwitchStore.getState().setPending(makePendingInfo())
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })

      const state = useSilentSwitchStore.getState()
      expect(state.pendingSwitch).toBeNull()
      expect(state.countdown).toBe(0)
    })

    it("replaces existing pending switch", () => {
      const info1 = makePendingInfo({ toCapability: "cap-1" })
      const info2 = makePendingInfo({ toCapability: "cap-2" })

      act(() => {
        useSilentSwitchStore.getState().setPending(info1)
        useSilentSwitchStore.getState().setPending(info2)
      })

      expect(useSilentSwitchStore.getState().pendingSwitch?.toCapability).toBe("cap-2")
    })
  })

  describe("confirm", () => {
    it("clears pendingSwitch and countdown", () => {
      act(() => {
        useSilentSwitchStore.getState().setPending(makePendingInfo())
        useSilentSwitchStore.getState().confirm()
      })

      const state = useSilentSwitchStore.getState()
      expect(state.pendingSwitch).toBeNull()
      expect(state.countdown).toBe(0)
    })
  })

  describe("undo", () => {
    it("restores original capability and session, ends new session", async () => {
      const info = makePendingInfo()
      act(() => {
        useSilentSwitchStore.getState().setPending(info)
      })

      await act(async () => {
        await useSilentSwitchStore.getState().undo()
      })

      // Should activate original capability
      expect(mockActivateCapability).toHaveBeenCalledWith("assistant")
      // Should resume original session
      expect(mockResumeSession).toHaveBeenCalledWith("session-from-001")
      // Should end the new session
      expect(mockEndSession).toHaveBeenCalledWith("session-to-001")
      // State should be cleared
      expect(useSilentSwitchStore.getState().pendingSwitch).toBeNull()
      expect(useSilentSwitchStore.getState().countdown).toBe(0)
    })

    it("no-op when no pending switch", async () => {
      await act(async () => {
        await useSilentSwitchStore.getState().undo()
      })

      expect(mockActivateCapability).not.toHaveBeenCalled()
      expect(mockResumeSession).not.toHaveBeenCalled()
      expect(mockEndSession).not.toHaveBeenCalled()
    })
  })
})
