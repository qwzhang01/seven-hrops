/**
 * Tests for dryRun invocation interceptor.
 */

import { describe, it, expect } from "vitest"
import { createDryRun, isDryRunEnvelope } from "./dryRun"

describe("dryRun", () => {
  it("records calls instead of dispatching", () => {
    const dr = createDryRun()
    const realInvoker = (() => {
      throw new Error("real invoker should NOT run in dry-run mode")
    }) as (n: string, a: unknown, c: unknown) => unknown
    const wrapped = dr.wrap(realInvoker)

    const result = wrapped("read_file", { path: "/etc/hosts" }, { sessionId: "s1" })
    expect(isDryRunEnvelope(result)).toBe(true)
    expect((result as { name: string }).name).toBe("read_file")
    expect(dr.calls).toHaveLength(1)
    expect(dr.calls[0]!.name).toBe("read_file")
    expect(dr.calls[0]!.args).toEqual({ path: "/etc/hosts" })
  })

  it("preserves chronological order across multiple calls", () => {
    const dr = createDryRun()
    const wrapped = dr.wrap(((n, a, c) => undefined) as never)
    wrapped("a", 1, null)
    wrapped("b", 2, null)
    wrapped("c", 3, null)
    expect(dr.calls.map((c) => c.name)).toEqual(["a", "b", "c"])
  })

  it("reset() empties the log", () => {
    const dr = createDryRun()
    const wrapped = dr.wrap(((n, a, c) => undefined) as never)
    wrapped("a", 1, null)
    dr.reset()
    expect(dr.calls).toHaveLength(0)
  })

  it("isDryRunEnvelope rejects non-envelopes", () => {
    expect(isDryRunEnvelope(null)).toBe(false)
    expect(isDryRunEnvelope({})).toBe(false)
    expect(isDryRunEnvelope({ name: "x" })).toBe(false)
    expect(isDryRunEnvelope({ __dryRun: true, name: "x", args: {} })).toBe(true)
  })
})
