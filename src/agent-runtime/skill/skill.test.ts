/**
 * Tests for the Skill module.
 *
 * Covers: get, all, available, register, registerMany, unregister, fmt.
 *
 * v2.0 platform foundation: the Service no longer ships any built-in skills.
 * Tests register their own fixtures via `service.register(...)` before asserting.
 * Built-in skills are validated separately in `builtinSeed.test.ts`.
 */

import { describe, it, expect, afterAll } from "vitest"
import { Effect, ManagedRuntime } from "effect"
import { Skill, fmt, type Info } from "../skill/index"

// ─── Fixtures ────────────────────────────────────────────────────────

const screenerFixture: Info = {
  name: "screener",
  description: "Screen resumes (fixture)",
  content: "# Resume Screening Skill\nSample content.",
}

const complianceFixture: Info = {
  name: "compliance",
  description: "Check compliance (fixture)",
  content: "# Compliance Checking Skill\nSample content.",
}

// ─── Pure function tests ─────────────────────────────────────────────

describe("Skill — fmt", () => {
  it("formats an empty list", () => {
    expect(fmt([])).toBe("No skills are currently available.")
  })

  it("formats a list of skills", () => {
    const skills: Info[] = [
      { name: "screener", description: "Screen resumes", content: "..." },
      { name: "compliance", description: "Check compliance", content: "..." },
    ]
    const result = fmt(skills)
    expect(result).toContain("## Available Skills")
    expect(result).toContain("**screener**: Screen resumes")
    expect(result).toContain("**compliance**: Check compliance")
  })

  it("formats skills without description", () => {
    const skills: Info[] = [
      { name: "test", content: "..." },
    ]
    const result = fmt(skills)
    expect(result).toContain("**test**: No description")
  })
})

// ─── Service tests ───────────────────────────────────────────────────

describe("Skill — Service", () => {
  const rt = ManagedRuntime.make(Skill.defaultLayer)

  it("starts empty", async () => {
    const skills = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Skill.Service
        return yield* service.all()
      }),
    )
    expect(skills).toEqual([])
  })

  it("get returns a registered skill", async () => {
    const skill = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Skill.Service
        yield* service.register(screenerFixture)
        return yield* service.get("screener")
      }),
    )
    expect(skill).toBeDefined()
    expect(skill!.name).toBe("screener")
    expect(skill!.content).toContain("Resume Screening Skill")
  })

  it("returns undefined for non-existent skill", async () => {
    const skill = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Skill.Service
        return yield* service.get("nonexistent")
      }),
    )
    expect(skill).toBeUndefined()
  })

  it("all returns sorted skills", async () => {
    const rt2 = ManagedRuntime.make(Skill.defaultLayer)
    const skills = await rt2.runPromise(
      Effect.gen(function* () {
        const service = yield* Skill.Service
        yield* service.register(screenerFixture)
        yield* service.register(complianceFixture)
        return yield* service.all()
      }),
    )
    expect(skills.map((s) => s.name)).toEqual(["compliance", "screener"])
    await rt2.dispose()
  })

  it("available returns all skills when no agent is specified", async () => {
    const rt2 = ManagedRuntime.make(Skill.defaultLayer)
    const skills = await rt2.runPromise(
      Effect.gen(function* () {
        const service = yield* Skill.Service
        yield* service.register(screenerFixture)
        yield* service.register(complianceFixture)
        return yield* service.available()
      }),
    )
    expect(skills).toHaveLength(2)
    await rt2.dispose()
  })

  it("register adds a new skill", async () => {
    const rt2 = ManagedRuntime.make(Skill.defaultLayer)
    const fetched = await rt2.runPromise(
      Effect.gen(function* () {
        const service = yield* Skill.Service
        yield* service.register({
          name: "interviewer",
          description: "Generate interview questions",
          content: "# Interview Skill\nAsk structured questions.",
        })
        return yield* service.get("interviewer")
      }),
    )
    expect(fetched).toBeDefined()
    expect(fetched!.name).toBe("interviewer")
    await rt2.dispose()
  })

  it("register throws for duplicate skill name", async () => {
    const rt2 = ManagedRuntime.make(Skill.defaultLayer)
    await expect(
      rt2.runPromise(
        Effect.gen(function* () {
          const service = yield* Skill.Service
          yield* service.register(screenerFixture)
          yield* service.register({ ...screenerFixture })
        }),
      ),
    ).rejects.toThrow("already exists")
    await rt2.dispose()
  })

  it("registerMany overwrites existing entries", async () => {
    const rt2 = ManagedRuntime.make(Skill.defaultLayer)
    const result = await rt2.runPromise(
      Effect.gen(function* () {
        const service = yield* Skill.Service
        yield* service.register(screenerFixture)
        yield* service.registerMany([
          { name: "skill-a", description: "Skill A", content: "A" },
          { name: "skill-b", description: "Skill B", content: "B" },
          { name: "screener", description: "Overwritten", content: "new" },
        ])
        const a = yield* service.get("skill-a")
        const b = yield* service.get("skill-b")
        const screener = yield* service.get("screener")
        return { a, b, screener }
      }),
    )
    expect(result.a?.name).toBe("skill-a")
    expect(result.b?.name).toBe("skill-b")
    expect(result.screener?.description).toBe("Overwritten")
    await rt2.dispose()
  })

  it("unregister removes a registered skill", async () => {
    const rt2 = ManagedRuntime.make(Skill.defaultLayer)
    const result = await rt2.runPromise(
      Effect.gen(function* () {
        const service = yield* Skill.Service
        yield* service.register(screenerFixture)
        const before = yield* service.get("screener")
        yield* service.unregister("screener")
        const after = yield* service.get("screener")
        return { before, after }
      }),
    )
    expect(result.before).toBeDefined()
    expect(result.after).toBeUndefined()
    await rt2.dispose()
  })

  it("unregister throws for non-existent skill", async () => {
    const rt2 = ManagedRuntime.make(Skill.defaultLayer)
    await expect(
      rt2.runPromise(
        Effect.gen(function* () {
          const service = yield* Skill.Service
          yield* service.unregister("never-registered")
        }),
      ),
    ).rejects.toThrow("Skill \"never-registered\" not found")
    await rt2.dispose()
  })

  afterAll(async () => {
    await rt.dispose()
  })
})
