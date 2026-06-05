/**
 * Tests for the Agent module.
 *
 * Covers: get/has, list, defaultAgent, register, unregister.
 *
 * v2.0 platform foundation: the Service no longer ships any built-in agents.
 * Tests register their own fixtures via `service.register(...)` before asserting.
 * Built-in agents are validated separately in `builtinSeed.test.ts`.
 */

import { describe, it, expect, afterAll } from "vitest"
import { Effect, ManagedRuntime } from "effect"
import { Agent, type Info } from "../agent/agent"

// ─── Fixtures ────────────────────────────────────────────────────────

const fixturePrimary: Info = {
  name: "assistant",
  description: "Primary fixture agent",
  mode: "primary",
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
  temperature: 0.7,
}

const fixtureSubA: Info = {
  name: "screener",
  description: "Subagent fixture A",
  mode: "subagent",
  permission: [{ permission: "read", pattern: "*", action: "allow" }],
  temperature: 0.3,
}

const fixtureSubB: Info = {
  name: "compliance",
  description: "Subagent fixture B",
  mode: "subagent",
  permission: [{ permission: "read", pattern: "*", action: "allow" }],
  temperature: 0.2,
}

const seed = (service: Awaited<ReturnType<typeof getService>>): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* service.register(fixturePrimary)
    yield* service.register(fixtureSubA)
    yield* service.register(fixtureSubB)
  })

const getService = () =>
  Effect.gen(function* () {
    return yield* Agent.Service
  })

// ─── get / has ───────────────────────────────────────────────────────

describe("Agent — get / has", () => {
  const rt = ManagedRuntime.make(Agent.defaultLayer)

  it("get returns a registered agent", async () => {
    const agent = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Agent.Service
        yield* service.register(fixturePrimary)
        return yield* service.get("assistant")
      }),
    )
    expect(agent.name).toBe("assistant")
    expect(agent.mode).toBe("primary")
  })

  it("get throws for non-existent agent", async () => {
    await expect(
      rt.runPromise(
        Effect.gen(function* () {
          const service = yield* Agent.Service
          yield* service.get("nonexistent")
        }),
      ),
    ).rejects.toThrow("Agent \"nonexistent\" not found")
  })

  it("has returns true for registered agent and false otherwise", async () => {
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Agent.Service
        const before = yield* service.has("screener")
        yield* service.register(fixtureSubA)
        const after = yield* service.has("screener")
        const missing = yield* service.has("never-registered")
        return { before, after, missing }
      }),
    )
    expect(result.before).toBe(false)
    expect(result.after).toBe(true)
    expect(result.missing).toBe(false)
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

// ─── defaultAgent ────────────────────────────────────────────────────

describe("Agent — defaultAgent", () => {
  const rt = ManagedRuntime.make(Agent.defaultLayer)

  it("returns the first registered primary agent", async () => {
    const name = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Agent.Service
        yield* seed(service)
        return yield* service.defaultAgent()
      }),
    )
    expect(name).toBe("assistant")
  })

  it("throws when no primary agent is registered", async () => {
    const rt2 = ManagedRuntime.make(Agent.defaultLayer)
    await expect(
      rt2.runPromise(
        Effect.gen(function* () {
          const service = yield* Agent.Service
          yield* service.register(fixtureSubA)
          return yield* service.defaultAgent()
        }),
      ),
    ).rejects.toThrow("No primary agent found")
    await rt2.dispose()
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

// ─── list ────────────────────────────────────────────────────────────

describe("Agent — list", () => {
  const rt = ManagedRuntime.make(Agent.defaultLayer)

  it("returns all registered agents (primary first, then subagents alphabetically)", async () => {
    const agents = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Agent.Service
        yield* seed(service)
        return yield* service.list()
      }),
    )
    expect(agents).toHaveLength(3)
    expect(agents[0].mode).toBe("primary")
    expect(agents[0].name).toBe("assistant")
    const subagents = agents.filter((a) => a.mode === "subagent")
    for (let i = 1; i < subagents.length; i++) {
      expect(subagents[i].name.localeCompare(subagents[i - 1].name)).toBeGreaterThanOrEqual(0)
    }
  })

  it("returns an empty array when nothing is registered", async () => {
    const rt2 = ManagedRuntime.make(Agent.defaultLayer)
    const agents = await rt2.runPromise(
      Effect.gen(function* () {
        const service = yield* Agent.Service
        return yield* service.list()
      }),
    )
    expect(agents).toEqual([])
    await rt2.dispose()
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

// ─── register ────────────────────────────────────────────────────────

describe("Agent — register", () => {
  const rt = ManagedRuntime.make(Agent.defaultLayer)

  it("registers a new agent", async () => {
    const newAgent: Info = {
      name: "onboarder",
      description: "Handles employee onboarding",
      mode: "subagent",
      permission: [],
      temperature: 0.5,
    }
    const fetched = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Agent.Service
        yield* service.register(newAgent)
        return yield* service.get("onboarder")
      }),
    )
    expect(fetched.name).toBe("onboarder")
    expect(fetched.description).toBe("Handles employee onboarding")
  })

  it("throws for duplicate agent name", async () => {
    await expect(
      rt.runPromise(
        Effect.gen(function* () {
          const service = yield* Agent.Service
          yield* service.register(fixturePrimary)
          yield* service.register({ ...fixturePrimary })
        }),
      ),
    ).rejects.toThrow("already exists")
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

// ─── unregister ──────────────────────────────────────────────────────

describe("Agent — unregister", () => {
  const rt = ManagedRuntime.make(Agent.defaultLayer)

  it("removes a registered agent", async () => {
    const result = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Agent.Service
        yield* service.register(fixtureSubA)
        const before = yield* service.has("screener")
        yield* service.unregister("screener")
        const after = yield* service.has("screener")
        return { before, after }
      }),
    )
    expect(result.before).toBe(true)
    expect(result.after).toBe(false)
  })

  it("throws when unregistering a non-existent agent", async () => {
    await expect(
      rt.runPromise(
        Effect.gen(function* () {
          const service = yield* Agent.Service
          yield* service.unregister("never-registered")
        }),
      ),
    ).rejects.toThrow("Agent \"never-registered\" not found")
  })

  it("subsequent register of the same name succeeds after unregister", async () => {
    const rt2 = ManagedRuntime.make(Agent.defaultLayer)
    const fetched = await rt2.runPromise(
      Effect.gen(function* () {
        const service = yield* Agent.Service
        yield* service.register(fixtureSubA)
        yield* service.unregister("screener")
        yield* service.register({ ...fixtureSubA, description: "rebuilt" })
        return yield* service.get("screener")
      }),
    )
    expect(fetched.description).toBe("rebuilt")
    await rt2.dispose()
  })

  afterAll(async () => {
    await rt.dispose()
  })
})
