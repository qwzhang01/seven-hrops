/**
 * SilentSwitchToast component tests — Phase G Task 9.6
 *
 * Covers:
 *   - Toast renders when pendingSwitch is set
 *   - Toast does not render when pendingSwitch is null
 *   - Countdown is displayed
 *   - Undo button triggers undo action
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { SilentSwitchToast } from "../chat/SilentSwitchToast"
import { useSilentSwitchStore } from "@/stores/silentSwitchStore"
import type { PendingSwitchInfo } from "@/stores/silentSwitchStore"

// ─── Mocks ───────────────────────────────────────────────────────────

const mockActivateCapability = vi.fn()
const mockResumeSession = vi.fn().mockResolvedValue(undefined)
const mockEndSession = vi.fn().mockResolvedValue(undefined)

vi.mock("@/stores/capabilityStore", () => ({
  useCapabilityStore: vi.fn((selector: (s: { records: unknown[]; activateCapability: typeof mockActivateCapability }) => unknown) =>
    selector({
      records: [
        {
          id: "resume-screening",
          manifest: { metadata: { displayName: "简历筛选" } },
        },
      ],
      activateCapability: mockActivateCapability,
    }),
  ),
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

describe("SilentSwitchToast", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
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

  it("does not render when no pending switch", () => {
    render(<SilentSwitchToast />)
    expect(screen.queryByTestId("silent-switch-toast")).toBeNull()
  })

  it("renders when pendingSwitch is set", () => {
    act(() => {
      useSilentSwitchStore.getState().setPending(makePendingInfo())
    })
    render(<SilentSwitchToast />)

    expect(screen.getByTestId("silent-switch-toast")).toBeTruthy()
    expect(screen.getByText(/已切换到「简历筛选」/)).toBeTruthy()
  })

  it("shows countdown seconds", () => {
    act(() => {
      useSilentSwitchStore.getState().setPending(makePendingInfo())
    })
    render(<SilentSwitchToast />)

    expect(screen.getByText(/3s 后确认/)).toBeTruthy()
  })

  it("undo button triggers undo action", async () => {
    act(() => {
      useSilentSwitchStore.getState().setPending(makePendingInfo())
    })
    render(<SilentSwitchToast />)

    const undoBtn = screen.getByTestId("silent-switch-undo")
    await act(async () => {
      fireEvent.click(undoBtn)
    })

    expect(mockActivateCapability).toHaveBeenCalledWith("assistant")
    expect(mockResumeSession).toHaveBeenCalledWith("session-from-001")
    expect(mockEndSession).toHaveBeenCalledWith("session-to-001")
  })

  it("toast disappears after undo", async () => {
    act(() => {
      useSilentSwitchStore.getState().setPending(makePendingInfo())
    })
    const { rerender } = render(<SilentSwitchToast />)

    await act(async () => {
      await useSilentSwitchStore.getState().undo()
    })
    rerender(<SilentSwitchToast />)

    expect(screen.queryByTestId("silent-switch-toast")).toBeNull()
  })
})
