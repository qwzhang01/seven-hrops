import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  record,
  flush,
  getSessionMetrics,
  getBufferSize,
  _resetForTest,
  _injectFlushFn,
  type MetricEvent,
} from "../metricsService"

const makeEvent = (overrides: Partial<MetricEvent> = {}): MetricEvent => ({
  type: "tool-call",
  sessionId: "session-1",
  timestamp: Date.now(),
  ...overrides,
})

describe("metricsService", () => {
  beforeEach(() => {
    _resetForTest()
  })

  // ── record ──────────────────────────────────────────────────────────

  describe("record", () => {
    it("adds event to buffer", () => {
      record(makeEvent())
      expect(getBufferSize()).toBe(1)
    })

    it("accumulates multiple events", () => {
      record(makeEvent({ sessionId: "s1" }))
      record(makeEvent({ sessionId: "s2" }))
      record(makeEvent({ sessionId: "s1" }))
      expect(getBufferSize()).toBe(3)
    })

    it("auto-flushes when buffer reaches 100", async () => {
      const flushMock = vi.fn().mockResolvedValue(undefined)
      _injectFlushFn(flushMock)

      // Fill buffer to 99 — no flush yet
      for (let i = 0; i < 99; i++) {
        record(makeEvent())
      }
      expect(flushMock).not.toHaveBeenCalled()

      // 100th event triggers auto-flush
      record(makeEvent())
      // Wait for the async fire-and-forget
      await new Promise((r) => setTimeout(r, 10))
      expect(flushMock).toHaveBeenCalledOnce()
    })
  })

  // ── flush ────────────────────────────────────────────────────────────

  describe("flush", () => {
    it("does nothing when buffer is empty", async () => {
      const flushMock = vi.fn().mockResolvedValue(undefined)
      _injectFlushFn(flushMock)
      await flush()
      expect(flushMock).not.toHaveBeenCalled()
    })

    it("calls injected flush function and clears buffer", async () => {
      const flushMock = vi.fn().mockResolvedValue(undefined)
      _injectFlushFn(flushMock)

      record(makeEvent())
      record(makeEvent())
      expect(getBufferSize()).toBe(2)

      await flush()
      expect(flushMock).toHaveBeenCalledOnce()
      expect(getBufferSize()).toBe(0)
    })

    it("restores buffer on flush failure", async () => {
      _injectFlushFn(async () => {
        throw new Error("write failed")
      })

      record(makeEvent())
      record(makeEvent())

      await flush()
      // Events should be restored to buffer
      expect(getBufferSize()).toBe(2)
    })
  })

  // ── getSessionMetrics ────────────────────────────────────────────────

  describe("getSessionMetrics", () => {
    it("returns events for the given session", () => {
      record(makeEvent({ sessionId: "s1", type: "tool-call" }))
      record(makeEvent({ sessionId: "s2", type: "token-usage" }))
      record(makeEvent({ sessionId: "s1", type: "error" }))

      const s1Events = getSessionMetrics("s1")
      expect(s1Events).toHaveLength(2)
      expect(s1Events.every((e) => e.sessionId === "s1")).toBe(true)
    })

    it("returns empty array when no events for session", () => {
      record(makeEvent({ sessionId: "s1" }))
      expect(getSessionMetrics("s99")).toHaveLength(0)
    })

    it("returns empty array when buffer is empty", () => {
      expect(getSessionMetrics("s1")).toHaveLength(0)
    })
  })
})
