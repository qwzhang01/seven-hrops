/**
 * Tests for rateLimiter (sliding window).
 */

import { describe, it, expect } from "vitest"
import { createRateLimiter, RateLimitExceededError } from "./rateLimiter"

describe("rateLimiter", () => {
  it("allows up to `limit` calls then rejects", () => {
    let now = 0
    const lim = createRateLimiter({ limit: 3, windowMs: 1000, now: () => now })
    expect(lim.tryAcquire("k")).toBe(true)
    expect(lim.tryAcquire("k")).toBe(true)
    expect(lim.tryAcquire("k")).toBe(true)
    expect(lim.tryAcquire("k")).toBe(false)
  })

  it("acquireOrThrow throws RateLimitExceededError with code", () => {
    let now = 0
    const lim = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now })
    lim.acquireOrThrow("k")
    try {
      lim.acquireOrThrow("k")
      throw new Error("expected throw")
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitExceededError)
      expect((e as RateLimitExceededError).code).toBe("RATE_LIMIT_EXCEEDED")
    }
  })

  it("recovers slots after window slides past old timestamps", () => {
    let now = 0
    const lim = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now })
    lim.tryAcquire("k") // t=0
    lim.tryAcquire("k") // t=0
    expect(lim.tryAcquire("k")).toBe(false)
    now = 1500 // slide past 1000ms
    expect(lim.tryAcquire("k")).toBe(true)
    expect(lim.size("k")).toBe(1)
  })

  it("isolates buckets per key", () => {
    let now = 0
    const lim = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now })
    expect(lim.tryAcquire("a")).toBe(true)
    expect(lim.tryAcquire("b")).toBe(true)
    expect(lim.tryAcquire("a")).toBe(false)
    expect(lim.tryAcquire("b")).toBe(false)
  })

  it("validates options", () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1000 })).toThrow()
    expect(() => createRateLimiter({ limit: 1, windowMs: 0 })).toThrow()
  })

  it("reset wipes all buckets", () => {
    let now = 0
    const lim = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now })
    lim.tryAcquire("k")
    lim.reset()
    expect(lim.size("k")).toBe(0)
    expect(lim.tryAcquire("k")).toBe(true)
  })
})
