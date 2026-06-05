/**
 * Silent Switch Store — manages the pending capability switch state for
 * the 3-second undo Toast.
 *
 * Design (D4): When assistant routes to a new capability, the switch is
 * "pending" for 3 seconds. During this window the user can undo.
 */

import { create } from "zustand"

// ─── Types ───────────────────────────────────────────────────────────

export interface PendingSwitchInfo {
  readonly fromCapability: string
  readonly fromSessionId: string
  readonly toCapability: string
  readonly toSessionId: string
}

interface SilentSwitchState {
  pendingSwitch: PendingSwitchInfo | null
  countdown: number // seconds remaining (3, 2, 1, 0)

  // Actions
  setPending: (info: PendingSwitchInfo) => void
  undo: () => Promise<void>
  confirm: () => void
  clear: () => void
}

// ─── Store ───────────────────────────────────────────────────────────

let countdownTimer: ReturnType<typeof setInterval> | null = null

export const useSilentSwitchStore = create<SilentSwitchState>((set, get) => ({
  pendingSwitch: null,
  countdown: 0,

  setPending: (info) => {
    // Clear any existing timer
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }

    set({ pendingSwitch: info, countdown: 3 })

    // Start countdown
    countdownTimer = setInterval(() => {
      const current = get().countdown
      if (current <= 1) {
        // Time's up — confirm the switch
        if (countdownTimer) {
          clearInterval(countdownTimer)
          countdownTimer = null
        }
        get().confirm()
      } else {
        set({ countdown: current - 1 })
      }
    }, 1000)
  },

  undo: async () => {
    const pending = get().pendingSwitch
    if (!pending) return

    // Clear timer
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }

    // Restore previous state
    const { useCapabilityStore } = await import("@/stores/capabilityStore")
    const { resumeSession, endSession } = await import("@/services/agentService")

    // Reactivate the original capability
    if (pending.fromCapability) {
      useCapabilityStore.getState().activateCapability(pending.fromCapability)
    }

    // Resume the original session
    if (pending.fromSessionId) {
      await resumeSession(pending.fromSessionId).catch(() => undefined)
    }

    // End the new session that was created
    if (pending.toSessionId) {
      await endSession(pending.toSessionId).catch(() => undefined)
    }

    set({ pendingSwitch: null, countdown: 0 })
  },

  confirm: () => {
    // Switch is confirmed — clear pending state
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    set({ pendingSwitch: null, countdown: 0 })
  },

  clear: () => {
    if (countdownTimer) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
    set({ pendingSwitch: null, countdown: 0 })
  },
}))
