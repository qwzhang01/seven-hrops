/**
 * Tests for ToolRegistry (Phase B contract).
 *
 * Coverage goal: ≥ 90% lines (every public API + every branch of
 * `assertAllowed` / `invoke` / `register`).
 *
 * The registry is a process-wide singleton populated by toolpack
 * `register(toolRegistry)` calls. To keep tests hermetic we always start
 * from a clean slate (`clearForTest()`) and seed exactly the metas each
 * test needs via `registerForTest`.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import {
  toolRegistry,
  type InvokeContext,
  type ToolMeta,
  type ToolSource,
} from "./toolRegistry"

// ─── Fixtures ────────────────────────────────────────────────────────

const ALL_SOURCES: ReadonlyArray<ToolSource> = ["builtin", "user", "marketplace"]
const BUILTIN_ONLY: ReadonlyArray<ToolSource> = ["builtin"]

const safeMeta: ToolMeta = {
  name: "read_file",
  category: "safe",
  riskLevel: "low",
  description: "fixture",
  defaultAllowedSources: ALL_SOURCES,
  requireApproval: false,
}

const sensitiveMeta: ToolMeta = {
  name: "delete_resume",
  category: "sensitive",
  riskLevel: "high",
  description: "fixture",
  defaultAllowedSources: BUILTIN_ONLY,
  requireApproval: true,
}

const writeMeta: ToolMeta = {
  name: "write_file",
  category: "write",
  riskLevel: "medium",
  description: "fixture",
  defaultAllowedSources: ["builtin", "user"],
  requireApproval: false,
}

beforeEach(() => {
  toolRegistry.clearForTest()
})

afterEach(() => {
  toolRegistry.clearForTest()
})

// ─── get / has / list ────────────────────────────────────────────────

describe("toolRegistry.get / has", () => {
  it("returns metadata for a registered tool", () => {
    toolRegistry.registerForTest(safeMeta)
    const meta = toolRegistry.get("read_file")
    expect(meta).toBeDefined()
    expect(meta!.category).toBe("safe")
    expect(meta!.defaultAllowedSources).toEqual(
      expect.arrayContaining(["builtin", "user", "marketplace"]),
    )
  })

  it("returns undefined / false for unknown tools", () => {
    expect(toolRegistry.get("non_existent")).toBeUndefined()
    expect(toolRegistry.has("non_existent")).toBe(false)
  })

  it("has returns true after register", () => {
    toolRegistry.registerForTest(safeMeta)
    expect(toolRegistry.has("read_file")).toBe(true)
  })
})

describe("toolRegistry.list", () => {
  beforeEach(() => {
    toolRegistry.registerForTest(safeMeta)
    toolRegistry.registerForTest(writeMeta)
    toolRegistry.registerForTest(sensitiveMeta)
  })

  it("returns the full catalogue when no filter is provided", () => {
    expect(toolRegistry.list().length).toBe(3)
  })

  it("filters by category", () => {
    const sensitive = toolRegistry.list({ category: "sensitive" })
    expect(sensitive.length).toBe(1)
    expect(sensitive[0].name).toBe("delete_resume")
  })

  it("filters by source (excludes builtin-only tools from user list)", () => {
    const userTools = toolRegistry.list({ source: "user" })
    expect(userTools.find((t) => t.name === "delete_resume")).toBeUndefined()
    expect(userTools.find((t) => t.name === "read_file")).toBeDefined()
    expect(userTools.find((t) => t.name === "write_file")).toBeDefined()
  })

  it("filters by riskLevel", () => {
    const high = toolRegistry.list({ riskLevel: "high" })
    expect(high.length).toBe(1)
    expect(high[0].name).toBe("delete_resume")
  })

  it("composes filters", () => {
    const builtinSensitive = toolRegistry.list({
      source: "builtin",
      category: "sensitive",
    })
    expect(builtinSensitive.length).toBe(1)
    expect(builtinSensitive[0].name).toBe("delete_resume")
  })
})

// ─── allowed / assertAllowed ─────────────────────────────────────────

describe("toolRegistry.allowed / assertAllowed", () => {
  beforeEach(() => {
    toolRegistry.registerForTest(safeMeta)
    toolRegistry.registerForTest(sensitiveMeta)
  })

  it("allowed → true for an allowed pair", () => {
    expect(toolRegistry.allowed("read_file", "user")).toBe(true)
  })

  it("allowed → false for a forbidden pair", () => {
    expect(toolRegistry.allowed("delete_resume", "user")).toBe(false)
  })

  it("allowed → false for unknown tools", () => {
    expect(toolRegistry.allowed("non_existent", "builtin")).toBe(false)
  })

  it("assertAllowed does not throw for builtin → sensitive tool", () => {
    expect(() => toolRegistry.assertAllowed("delete_resume", "builtin")).not.toThrow()
  })

  it("assertAllowed does not throw for user → safe tool", () => {
    expect(() => toolRegistry.assertAllowed("read_file", "user")).not.toThrow()
  })

  it("throws TOOL_NOT_PERMITTED_FOR_SOURCE for user → sensitive tool", () => {
    expect(() => toolRegistry.assertAllowed("delete_resume", "user")).toThrow(
      /TOOL_NOT_PERMITTED_FOR_SOURCE/,
    )
  })

  it("error message carries tool name, source and allowed list", () => {
    try {
      toolRegistry.assertAllowed("delete_resume", "user")
      throw new Error("expected to throw")
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain("TOOL_NOT_PERMITTED_FOR_SOURCE")
      expect(msg).toContain("delete_resume")
      expect(msg).toContain("user")
      expect(msg).toContain("builtin")
    }
  })

  it("throws UNKNOWN_TOOL for unknown tools", () => {
    expect(() => toolRegistry.assertAllowed("non_existent", "builtin")).toThrow(
      /UNKNOWN_TOOL/,
    )
  })
})

// ─── register / invoke ───────────────────────────────────────────────

describe("toolRegistry.register", () => {
  it("registers a meta + invoker pair", () => {
    const fn = vi.fn().mockResolvedValue("ok")
    toolRegistry.register(safeMeta, fn)
    expect(toolRegistry.has("read_file")).toBe(true)
  })

  it("throws TOOL_INVOKER_MISSING when invoker is not a function", () => {
    expect(() =>
      // @ts-expect-error intentional bad input
      toolRegistry.register(safeMeta, undefined),
    ).toThrow(/TOOL_INVOKER_MISSING/)
  })

  it("throws DUPLICATE_TOOL_NAME on second register of the same name", () => {
    toolRegistry.register(safeMeta, async () => "first")
    expect(() => toolRegistry.register(safeMeta, async () => "second")).toThrow(
      /DUPLICATE_TOOL_NAME/,
    )
  })
})

describe("toolRegistry.invoke", () => {
  const ctx: InvokeContext = { sessionId: "sess-1", source: "user" }

  it("calls the invoker with args + ctx and resolves its return value", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true })
    toolRegistry.register(safeMeta, fn)
    const result = await toolRegistry.invoke("read_file", { path: "/tmp/x" }, ctx)
    expect(result).toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith({ path: "/tmp/x" }, ctx)
  })

  it("wraps a synchronous invoker return value in Promise.resolve", async () => {
    toolRegistry.register(safeMeta, () => "sync-return")
    await expect(
      toolRegistry.invoke("read_file", {}, ctx),
    ).resolves.toBe("sync-return")
  })

  it("rejects with MISSING_SESSION_ID for empty sessionId", async () => {
    toolRegistry.register(safeMeta, async () => undefined)
    await expect(
      toolRegistry.invoke("read_file", {}, { sessionId: "", source: "user" }),
    ).rejects.toThrow(/MISSING_SESSION_ID/)
  })

  it("rejects with UNKNOWN_TOOL when no such tool", async () => {
    await expect(
      toolRegistry.invoke("non_existent", {}, ctx),
    ).rejects.toThrow(/UNKNOWN_TOOL/)
  })

  it("rejects with TOOL_NOT_PERMITTED_FOR_SOURCE when source is forbidden", async () => {
    toolRegistry.register(sensitiveMeta, async () => "shouldnt-run")
    await expect(
      toolRegistry.invoke("delete_resume", {}, { sessionId: "s", source: "user" }),
    ).rejects.toThrow(/TOOL_NOT_PERMITTED_FOR_SOURCE/)
  })

  it("propagates invoker rejections", async () => {
    toolRegistry.register(safeMeta, async () => {
      throw new Error("BOOM")
    })
    await expect(
      toolRegistry.invoke("read_file", {}, ctx),
    ).rejects.toThrow(/BOOM/)
  })
})

// ─── test-only helpers ───────────────────────────────────────────────

describe("test-only helpers", () => {
  it("registerForTest / unregisterForTest round-trip", () => {
    const meta: ToolMeta = {
      name: "test_only_tool",
      category: "safe",
      riskLevel: "low",
      description: "test fixture",
      defaultAllowedSources: ["builtin"],
      requireApproval: false,
    }
    toolRegistry.registerForTest(meta)
    expect(toolRegistry.has("test_only_tool")).toBe(true)
    expect(toolRegistry.get("test_only_tool")?.description).toBe("test fixture")
    expect(toolRegistry.unregisterForTest("test_only_tool")).toBe(true)
    expect(toolRegistry.has("test_only_tool")).toBe(false)
  })

  it("registerForTest allows overwrite (idempotent fixture rebuild)", () => {
    toolRegistry.registerForTest(safeMeta, () => "v1")
    toolRegistry.registerForTest(safeMeta, () => "v2")
    expect(toolRegistry.has("read_file")).toBe(true)
  })

  it("clearForTest empties the registry", () => {
    toolRegistry.registerForTest(safeMeta)
    toolRegistry.clearForTest()
    expect(toolRegistry.has("read_file")).toBe(false)
  })
})

// ─── Phase F: listByCategory + NetworkToolMustGatePermission ─────────

describe("toolRegistry.listByCategory (Phase F Task 1.7)", () => {
  const networkMeta: ToolMeta = {
    name: "get_weather",
    category: "network",
    riskLevel: "medium",
    description: "fixture network tool",
    defaultAllowedSources: ["builtin"],
    requireApproval: false,
  }

  const networkMeta2: ToolMeta = {
    name: "recommend_tracks",
    category: "network",
    riskLevel: "medium",
    description: "fixture network tool 2",
    defaultAllowedSources: ["builtin"],
    requireApproval: false,
  }

  beforeEach(() => {
    toolRegistry.registerForTest(safeMeta)
    toolRegistry.registerForTest(writeMeta)
    toolRegistry.registerForTest(networkMeta)
    toolRegistry.registerForTest(networkMeta2)
  })

  it("returns only tools matching the given category", () => {
    const networkTools = toolRegistry.listByCategory("network")
    expect(networkTools.length).toBe(2)
    expect(networkTools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["get_weather", "recommend_tracks"]),
    )
  })

  it("returns empty array for category with no tools", () => {
    expect(toolRegistry.listByCategory("builder").length).toBe(0)
  })

  it("does not include tools from other categories", () => {
    const networkTools = toolRegistry.listByCategory("network")
    expect(networkTools.find((t) => t.name === "read_file")).toBeUndefined()
    expect(networkTools.find((t) => t.name === "write_file")).toBeUndefined()
  })
})

describe("toolRegistry.register NetworkToolMustGatePermission (Phase F Task 1.6)", () => {
  it("throws when network tool allows user source without requiresPermissionPrompt", () => {
    const badNetworkMeta: ToolMeta = {
      name: "bad_network_tool",
      category: "network",
      riskLevel: "medium",
      description: "should be rejected",
      defaultAllowedSources: ["builtin", "user"],
      requireApproval: false,
    }
    expect(() =>
      toolRegistry.register(badNetworkMeta, async () => undefined),
    ).toThrow(/NetworkToolMustGatePermission/)
  })

  it("allows network tool with user source when requiresPermissionPrompt is true", () => {
    const goodNetworkMeta: ToolMeta = {
      name: "good_network_tool",
      category: "network",
      riskLevel: "medium",
      description: "should be accepted",
      defaultAllowedSources: ["builtin", "user"],
      requireApproval: false,
      requiresPermissionPrompt: true,
    }
    expect(() =>
      toolRegistry.register(goodNetworkMeta, async () => undefined),
    ).not.toThrow()
  })

  it("allows network tool with builtin-only source without requiresPermissionPrompt", () => {
    const builtinOnlyNetworkMeta: ToolMeta = {
      name: "builtin_network_tool",
      category: "network",
      riskLevel: "medium",
      description: "builtin only, no prompt needed",
      defaultAllowedSources: ["builtin"],
      requireApproval: false,
    }
    expect(() =>
      toolRegistry.register(builtinOnlyNetworkMeta, async () => undefined),
    ).not.toThrow()
  })
})

// ─── Effect Layer wrapper (5.4) ──────────────────────────────────────

import { Effect, Layer } from "effect"
import { ToolRegistryService, ToolRegistryServiceLive } from "./toolRegistry"

describe("ToolRegistryService (Effect Layer wrapper)", () => {
  beforeEach(() => {
    toolRegistry.clearForTest()
  })

  it("Live layer resolves to the same singleton instance", async () => {
    const program = Effect.gen(function* () {
      const reg = yield* ToolRegistryService
      return reg
    })
    const resolved = await Effect.runPromise(
      program.pipe(Effect.provide(ToolRegistryServiceLive)),
    )
    expect(resolved).toBe(toolRegistry)
  })

  it("registrations via singleton are visible through Layer", async () => {
    toolRegistry.registerForTest(safeMeta)
    const program = Effect.gen(function* () {
      const reg = yield* ToolRegistryService
      return reg.has("read_file")
    })
    const has = await Effect.runPromise(
      program.pipe(Effect.provide(ToolRegistryServiceLive)),
    )
    expect(has).toBe(true)
  })

  it("can be replaced with a stub Layer in tests (DI override)", async () => {
    const stub = {
      ...toolRegistry,
      has: () => true, // stubbed branch
    } as typeof toolRegistry
    const StubLayer = Layer.succeed(ToolRegistryService, stub)

    const program = Effect.gen(function* () {
      const reg = yield* ToolRegistryService
      return reg.has("anything-not-registered")
    })
    const has = await Effect.runPromise(program.pipe(Effect.provide(StubLayer)))
    expect(has).toBe(true) // proves the stub took effect
  })
})
