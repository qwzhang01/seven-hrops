import { describe, it, expect, beforeEach } from "vitest"
import { usePermissionStore, type PermissionRequest } from "../permissionStore"

const makeReq = (overrides: Partial<Omit<PermissionRequest, "status">> = {}): Omit<PermissionRequest, "status"> => ({
  id: `req-${Math.random().toString(36).slice(2, 7)}`,
  sessionId: "session-1",
  toolName: "fs_write_file",
  riskLevel: "high",
  description: "Write to workspace file",
  requestedAt: Date.now(),
  ...overrides,
})

describe("permissionStore", () => {
  beforeEach(() => {
    usePermissionStore.setState({ queue: [] })
  })

  // ── enqueue ──────────────────────────────────────────────────────────

  describe("enqueue", () => {
    it("adds request with pending status", () => {
      const req = makeReq({ id: "r1" })
      usePermissionStore.getState().enqueue(req)
      const { queue } = usePermissionStore.getState()
      expect(queue).toHaveLength(1)
      expect(queue[0].status).toBe("pending")
      expect(queue[0].id).toBe("r1")
    })

    it("accumulates multiple requests", () => {
      usePermissionStore.getState().enqueue(makeReq({ id: "r1" }))
      usePermissionStore.getState().enqueue(makeReq({ id: "r2" }))
      expect(usePermissionStore.getState().queue).toHaveLength(2)
    })
  })

  // ── approve ──────────────────────────────────────────────────────────

  describe("approve", () => {
    it("sets status to approved for matching id", () => {
      usePermissionStore.getState().enqueue(makeReq({ id: "r1" }))
      usePermissionStore.getState().approve("r1")
      const req = usePermissionStore.getState().queue.find((r) => r.id === "r1")
      expect(req?.status).toBe("approved")
    })

    it("does not affect other requests", () => {
      usePermissionStore.getState().enqueue(makeReq({ id: "r1" }))
      usePermissionStore.getState().enqueue(makeReq({ id: "r2" }))
      usePermissionStore.getState().approve("r1")
      const r2 = usePermissionStore.getState().queue.find((r) => r.id === "r2")
      expect(r2?.status).toBe("pending")
    })
  })

  // ── deny ─────────────────────────────────────────────────────────────

  describe("deny", () => {
    it("sets status to denied for matching id", () => {
      usePermissionStore.getState().enqueue(makeReq({ id: "r1" }))
      usePermissionStore.getState().deny("r1")
      const req = usePermissionStore.getState().queue.find((r) => r.id === "r1")
      expect(req?.status).toBe("denied")
    })
  })

  // ── clear ────────────────────────────────────────────────────────────

  describe("clear", () => {
    it("empties the queue", () => {
      usePermissionStore.getState().enqueue(makeReq())
      usePermissionStore.getState().enqueue(makeReq())
      usePermissionStore.getState().clear()
      expect(usePermissionStore.getState().queue).toHaveLength(0)
    })
  })

  // ── pendingCount ─────────────────────────────────────────────────────

  describe("pendingCount", () => {
    it("counts only pending requests", () => {
      usePermissionStore.getState().enqueue(makeReq({ id: "r1" }))
      usePermissionStore.getState().enqueue(makeReq({ id: "r2" }))
      usePermissionStore.getState().enqueue(makeReq({ id: "r3" }))
      usePermissionStore.getState().approve("r1")
      usePermissionStore.getState().deny("r2")
      expect(usePermissionStore.getState().pendingCount()).toBe(1)
    })

    it("returns 0 when queue is empty", () => {
      expect(usePermissionStore.getState().pendingCount()).toBe(0)
    })
  })

  // ── currentRequest ───────────────────────────────────────────────────

  describe("currentRequest", () => {
    it("returns first pending request", () => {
      usePermissionStore.getState().enqueue(makeReq({ id: "r1" }))
      usePermissionStore.getState().enqueue(makeReq({ id: "r2" }))
      expect(usePermissionStore.getState().currentRequest()?.id).toBe("r1")
    })

    it("skips non-pending requests", () => {
      usePermissionStore.getState().enqueue(makeReq({ id: "r1" }))
      usePermissionStore.getState().enqueue(makeReq({ id: "r2" }))
      usePermissionStore.getState().approve("r1")
      expect(usePermissionStore.getState().currentRequest()?.id).toBe("r2")
    })

    it("returns null when no pending requests", () => {
      expect(usePermissionStore.getState().currentRequest()).toBeNull()
    })

    it("returns null when all requests are resolved", () => {
      usePermissionStore.getState().enqueue(makeReq({ id: "r1" }))
      usePermissionStore.getState().deny("r1")
      expect(usePermissionStore.getState().currentRequest()).toBeNull()
    })
  })
})
