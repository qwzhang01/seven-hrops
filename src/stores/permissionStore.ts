/**
 * Permission Store — sandbox permission request queue.
 *
 * Design notes:
 *   - All actions are synchronous (no async logic).
 *   - The queue holds PermissionRequest objects with status tracking.
 *   - Phase D's PermissionPrompt component subscribes to currentRequest().
 *   - The sandbox's toolWhitelistGuard enqueues requests for high-risk tools.
 */

import { create } from "zustand"
import type { RiskLevel, PermissionStatus, PermissionRequest } from "@/types/permission"

export type { RiskLevel, PermissionStatus, PermissionRequest }

interface PermissionState {
  queue: PermissionRequest[]

  // Derived (computed from queue)
  pendingCount: () => number
  currentRequest: () => PermissionRequest | null

  // Actions (all synchronous)
  enqueue: (req: Omit<PermissionRequest, "status">) => void
  approve: (id: string) => void
  deny: (id: string) => void
  clear: () => void
}

// ─── Store ───────────────────────────────────────────────────────────

export const usePermissionStore = create<PermissionState>()((set, get) => ({
  queue: [],

  pendingCount: () => get().queue.filter((r) => r.status === "pending").length,

  currentRequest: () => get().queue.find((r) => r.status === "pending") ?? null,

  enqueue: (req) =>
    set((s) => ({
      queue: [...s.queue, { ...req, status: "pending" as const }],
    })),

  approve: (id) =>
    set((s) => ({
      queue: s.queue.map((r) =>
        r.id === id ? { ...r, status: "approved" as const } : r,
      ),
    })),

  deny: (id) =>
    set((s) => ({
      queue: s.queue.map((r) =>
        r.id === id ? { ...r, status: "denied" as const } : r,
      ),
    })),

  clear: () => set({ queue: [] }),
}))
