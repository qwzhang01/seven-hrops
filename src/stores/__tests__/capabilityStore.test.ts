import { describe, it, expect, beforeEach, vi } from "vitest"
import { useCapabilityStore } from "../capabilityStore"
import { capabilityRegistry } from "@/platform/registry/capabilityRegistry"

const installTestCapability = (name: string, order = 1) => {
  capabilityRegistry.install({
    apiVersion: "hsas.seven-hrops/v1",
    kind: "Capability",
    metadata: {
      name,
      displayName: `Capability ${name}`,
      description: `${name} entry-point card`,
      source: "builtin",
      version: "1.0.0",
      createdAt: "2026-05-27T10:00:00Z",
    },
    spec: {
      agentName: `${name}-agent`,
      category: "hr-screening",
      contextKeys: [],
      order,
    },
  })
}

describe("capabilityStore", () => {
  beforeEach(() => {
    capabilityRegistry.resetForTest()
    useCapabilityStore.setState({
      records: [],
      activeCapabilityId: null,
      isLoading: false,
      error: null,
    })
  })

  // ── loadCapabilities ─────────────────────────────────────────────────

  describe("loadCapabilities", () => {
    it("loads enabled capabilities from registry", () => {
      installTestCapability("cap-a")
      installTestCapability("cap-b")

      useCapabilityStore.getState().loadCapabilities()

      const { records, isLoading, error } = useCapabilityStore.getState()
      expect(records).toHaveLength(2)
      expect(isLoading).toBe(false)
      expect(error).toBeNull()
    })

    it("returns empty array when registry is empty", () => {
      useCapabilityStore.getState().loadCapabilities()
      expect(useCapabilityStore.getState().records).toHaveLength(0)
    })

    it("sets isLoading to false after load", () => {
      useCapabilityStore.getState().loadCapabilities()
      expect(useCapabilityStore.getState().isLoading).toBe(false)
    })

    it("sets error when registry throws", () => {
      vi.spyOn(capabilityRegistry, "list").mockImplementationOnce(() => {
        throw new Error("registry error")
      })
      useCapabilityStore.getState().loadCapabilities()
      expect(useCapabilityStore.getState().error).toContain("registry error")
      expect(useCapabilityStore.getState().isLoading).toBe(false)
    })
  })

  // ── setActive ────────────────────────────────────────────────────────

  describe("setActive", () => {
    it("updates activeCapabilityId", () => {
      useCapabilityStore.getState().setActive("cap-a")
      expect(useCapabilityStore.getState().activeCapabilityId).toBe("cap-a")
    })

    it("accepts null to clear selection", () => {
      useCapabilityStore.setState({ activeCapabilityId: "cap-a" })
      useCapabilityStore.getState().setActive(null)
      expect(useCapabilityStore.getState().activeCapabilityId).toBeNull()
    })
  })

  // ── activateCapability ───────────────────────────────────────────────

  describe("activateCapability", () => {
    it("sets activeCapabilityId", () => {
      useCapabilityStore.getState().activateCapability("cap-a")
      expect(useCapabilityStore.getState().activeCapabilityId).toBe("cap-a")
    })

    it("dispatches capability:activated CustomEvent", () => {
      const handler = vi.fn()
      window.addEventListener("capability:activated", handler)

      useCapabilityStore.getState().activateCapability("cap-a")

      expect(handler).toHaveBeenCalledOnce()
      const event = handler.mock.calls[0][0] as CustomEvent
      expect(event.detail).toEqual({ id: "cap-a" })

      window.removeEventListener("capability:activated", handler)
    })
  })

  // ── Phase F Task 13.1: 7 new capabilities order correctly ─────────────

  describe("Phase F: 8 capabilities sorted by order", () => {
    it("loads 8 capabilities and sorts by spec.order ascending", () => {
      // Install all 8 capabilities with their correct orders
      const capabilities = [
        { name: "resume-screening", order: 1 },
        { name: "jd-optimization", order: 20 },
        { name: "interview-outline", order: 30 },
        { name: "written-test", order: 40 },
        { name: "interview-eval", order: 50 },
        { name: "employee-interview", order: 60 },
        { name: "report-writing", order: 70 },
        { name: "music-radio", order: 80 },
      ]

      for (const cap of capabilities) {
        installTestCapability(cap.name, cap.order)
      }

      useCapabilityStore.getState().loadCapabilities()
      const { records } = useCapabilityStore.getState()

      expect(records).toHaveLength(8)

      // Verify order is ascending
      const orders = records.map((r) => r.manifest.spec.order)
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1])
      }

      // Verify no NaN
      expect(orders.every((o) => !isNaN(o))).toBe(true)

      // Verify no duplicates
      const names = records.map((r) => r.id)
      expect(new Set(names).size).toBe(names.length)
    })

    it("no NaN or duplicate order values", () => {
      installTestCapability("cap-1", 10)
      installTestCapability("cap-2", 20)
      installTestCapability("cap-3", 30)

      useCapabilityStore.getState().loadCapabilities()
      const orders = useCapabilityStore.getState().records.map((r) => r.manifest.spec.order)

      expect(orders.every((o) => typeof o === "number" && !isNaN(o))).toBe(true)
      // Orders should be unique
      expect(new Set(orders).size).toBe(orders.length)
    })
  })
})

