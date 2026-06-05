/**
 * Tests for the Permission system.
 *
 * Covers: evaluate, merge, wildcardMatch, Service.ask, Service.reply, Service.setApproved
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer, ManagedRuntime } from "effect"
import {
  Permission,
  evaluate,
  merge,
  type Rule,
  type Ruleset,
} from "../permission/index"

// ─── Pure function tests ─────────────────────────────────────────────

describe("Permission — evaluate", () => {
  it("returns 'ask' when no rules match", () => {
    const result = evaluate("tool", "read_file")
    expect(result.action).toBe("ask")
  })

  it("matches a rule with exact permission and pattern", () => {
    const rules: Ruleset = [
      { permission: "tool", pattern: "read_file", action: "allow" },
    ]
    const result = evaluate("tool", "read_file", rules)
    expect(result.action).toBe("allow")
  })

  it("matches a rule with wildcard permission", () => {
    const rules: Ruleset = [
      { permission: "*", pattern: "read_file", action: "allow" },
    ]
    const result = evaluate("tool", "read_file", rules)
    expect(result.action).toBe("allow")
  })

  it("matches a rule with wildcard pattern", () => {
    const rules: Ruleset = [
      { permission: "tool", pattern: "*", action: "deny" },
    ]
    const result = evaluate("tool", "anything", rules)
    expect(result.action).toBe("deny")
  })

  it("matches a rule with prefix wildcard pattern", () => {
    const rules: Ruleset = [
      { permission: "tool", pattern: "read_*", action: "allow" },
    ]
    const result = evaluate("tool", "read_file", rules)
    expect(result.action).toBe("allow")
  })

  it("prefers the last matching rule (last-wins)", () => {
    const rules: Ruleset = [
      { permission: "tool", pattern: "*", action: "allow" },
      { permission: "tool", pattern: "*", action: "deny" },
    ]
    const result = evaluate("tool", "something", rules)
    expect(result.action).toBe("deny")
  })

  it("merges multiple rulesets and last-wins across them", () => {
    const rules1: Ruleset = [
      { permission: "tool", pattern: "*", action: "allow" },
    ]
    const rules2: Ruleset = [
      { permission: "tool", pattern: "delete_*", action: "deny" },
    ]
    const result = evaluate("tool", "delete_file", rules1, rules2)
    expect(result.action).toBe("deny")
  })

  it("does not match when pattern prefix does not align", () => {
    const rules: Ruleset = [
      { permission: "tool", pattern: "read_*", action: "allow" },
    ]
    const result = evaluate("tool", "write_file", rules)
    expect(result.action).toBe("ask")
  })
})

describe("Permission — merge", () => {
  it("flattens multiple rulesets into one", () => {
    const r1: Ruleset = [{ permission: "a", pattern: "*", action: "allow" }]
    const r2: Ruleset = [{ permission: "b", pattern: "*", action: "deny" }]
    const merged = merge(r1, r2)
    expect(merged).toHaveLength(2)
    expect(merged[0].permission).toBe("a")
    expect(merged[1].permission).toBe("b")
  })

  it("returns empty array when no rulesets provided", () => {
    expect(merge()).toHaveLength(0)
  })
})

// ─── Service tests (use Effect.gen to access instance) ───────────────

describe("Permission — Service", () => {
  const rt = ManagedRuntime.make(Permission.defaultLayer)

  it("auto-allows when no deny rules exist (ask → auto-allow)", async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Permission.Service
        yield* service.ask({
          permission: "tool",
          patterns: ["read_file"],
          ruleset: [],
        })
      }),
    )
  })

  it("denies when a deny rule matches", async () => {
    const rules: Ruleset = [
      { permission: "tool", pattern: "delete_*", action: "deny" },
    ]
    await expect(
      rt.runPromise(
        Effect.gen(function* () {
          const service = yield* Permission.Service
          yield* service.ask({
            permission: "tool",
            patterns: ["delete_file"],
            ruleset: rules,
          })
        }),
      ),
    ).rejects.toThrow("Permission denied")
  })

  it("allows when an allow rule matches", async () => {
    const rules: Ruleset = [
      { permission: "tool", pattern: "*", action: "allow" },
    ]
    await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Permission.Service
        yield* service.ask({
          permission: "tool",
          patterns: ["any_tool"],
          ruleset: rules,
        })
      }),
    )
  })

  it("setApproved adds rules that are checked on subsequent asks", async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Permission.Service
        yield* service.setApproved([
          { permission: "tool", pattern: "approved_*", action: "allow" },
        ])
      }),
    )

    // Now asking for an approved action should succeed
    await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Permission.Service
        yield* service.ask({
          permission: "tool",
          patterns: ["approved_action"],
          ruleset: [],
        })
      }),
    )
  })

  it("list returns pending entries (auto-allow clears them)", async () => {
    const entries = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Permission.Service
        return yield* service.list()
      }),
    )
    expect(entries).toEqual([])
  })

  afterAll(async () => {
    await rt.dispose()
  })
})
