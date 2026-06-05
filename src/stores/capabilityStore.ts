/**
 * Capability Store — Capability catalogue and active selection.
 *
 * Design notes:
 *   - Reads from capabilityRegistry (synchronous singleton) — no Effect runtime needed.
 *   - activeCapabilityId is persisted to localStorage.
 *   - activateCapability dispatches a CustomEvent for loose coupling with workspaceStore.
 *   - loadCapabilities is called once after bootstrap() in main.tsx.
 */

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { capabilityRegistry, type CapabilityRecord } from "@/platform/registry/capabilityRegistry"

// ─── State ───────────────────────────────────────────────────────────

interface CapabilityState {
  records: CapabilityRecord[]
  activeCapabilityId: string | null
  isLoading: boolean
  error: string | null

  // Actions
  loadCapabilities: () => void
  setActive: (id: string | null) => void
  activateCapability: (id: string) => void
  getActive: () => CapabilityRecord | null
}

// ─── Store ───────────────────────────────────────────────────────────

export const useCapabilityStore = create<CapabilityState>()(
  persist(
    (set, get) => ({
      records: [],
      activeCapabilityId: null,
      isLoading: false,
      error: null,

      loadCapabilities: () => {
        set({ isLoading: true, error: null })
        try {
          const records = capabilityRegistry.list({ enabled: true }) as CapabilityRecord[]
          set({ records: [...records], isLoading: false })
        } catch (e) {
          set({ error: String(e), isLoading: false })
        }
      },

      setActive: (id) => set({ activeCapabilityId: id }),

      activateCapability: (id) => {
        set({ activeCapabilityId: id })
        // Dispatch CustomEvent for loose coupling — workspaceStore listens to this
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("capability:activated", { detail: { id } }))
        }
      },

      getActive: () => {
        const { records, activeCapabilityId } = get()
        return records.find((r) => r.id === activeCapabilityId) ?? null
      },
    }),
    {
      name: "capability-store",
      partialize: (state) => ({ activeCapabilityId: state.activeCapabilityId }),
    },
  ),
)
