/**
 * Integration test: source-aware tool authorisation.
 *
 * The platform layer enforces a defence-in-depth rule: tools that are
 * marked as "builtin-only" in the ToolRegistry MUST be rejected when a
 * user-source Agent manifest tries to allow them.
 *
 * Two distinct rejection paths exist:
 *   - Validator (early): `TOOL_NOT_PERMITTED_FOR_SOURCE` raised by
 *     manifestValidator when a `validationContext` provides
 *     `toolAllowedForSource`.
 *   - Runtime (late):    `toolRegistry.assertAllowed` raised inside
 *     agentLoader.load when no validation context was provided.
 *
 * This test exercises both.
 */

import { afterEach, beforeEach, describe, it, expect } from "vitest"
import { Effect, ManagedRuntime, Layer } from "effect"
import { Agent } from "@/agent-runtime/agent/agent"
import { Skill } from "@/agent-runtime/skill/index"
import { agentLoader } from "@/platform/loader/agentLoader"
import { toolRegistry } from "@/platform/registry/toolRegistry"
import { ValidationError } from "@/platform/hsas/validator"

const platformLayer = Layer.mergeAll(Agent.defaultLayer, Skill.defaultLayer)

let runtime: ReturnType<typeof ManagedRuntime.make<typeof platformLayer, never>>

beforeEach(() => {
  runtime = ManagedRuntime.make(platformLayer)
  // Make sure the dangerous tool exists in the registry and is marked as
  // builtin-only. (toolRegistry is a singleton populated at module import
  // time; the test re-asserts the contract regardless of seed order.)
  if (!toolRegistry.has("delete_resume")) {
    toolRegistry.registerForTest({
      name: "delete_resume",
      category: "sensitive",
      riskLevel: "critical",
      description: "Permanently delete a candidate resume",
      defaultAllowedSources: ["builtin"],
      requireApproval: true,
    })
  }
})

afterEach(async () => {
  await runtime.dispose()
})

const userSourceAgent = (allowedTools: ReadonlyArray<string>) => ({
  apiVersion: "hsas.seven-hrops/v1",
  kind: "Agent",
  metadata: {
    name: "rogue-agent",
    displayName: "Rogue Agent",
    description: "An agent claiming user source attempting builtin-only tools",
    source: "user",
    version: "1.0.0",
    createdAt: "2026-05-27T10:00:00Z",
  },
  spec: {
    mode: "primary",
    basePrompt:
      "You are a rogue agent. The validator should never let me speak.",
    tools: { allowed: [...allowedTools] },
  },
})

describe("user-source-permission (integration)", () => {
  it("rejects user-source agent that allows a builtin-only tool — Validator path", async () => {
    const exit = await runtime.runPromiseExit(
      agentLoader.load(userSourceAgent(["delete_resume"]), {
        validationContext: {
          toolExists: (n) => toolRegistry.has(n),
          toolAllowedForSource: (n, s) => toolRegistry.allowed(n, s),
        },
      }),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      // The cause carries the ValidationError; we reach into it via toString
      // to keep the assertion robust against Effect's internal cause shape.
      const text = String(exit.cause)
      expect(text).toContain("TOOL_NOT_PERMITTED_FOR_SOURCE")
    }
  })

  it("rejects user-source agent at runtime even with the validator predicate stripped", async () => {
    const exit = await runtime.runPromiseExit(
      agentLoader.load(userSourceAgent(["delete_resume"]), {
        // Intentionally drop `toolAllowedForSource`; runtime guard should
        // still slam the door shut.
        validationContext: {
          toolExists: (n) => toolRegistry.has(n),
        },
      }),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("accepts user-source agent that only uses tools whitelisted for user", async () => {
    if (!toolRegistry.has("read_file")) {
      toolRegistry.registerForTest({
        name: "read_file",
        category: "safe",
        riskLevel: "low",
        description: "Read a file",
        defaultAllowedSources: ["builtin", "user", "marketplace"],
        requireApproval: false,
      })
    }

    const info = await runtime.runPromise(
      agentLoader.load(userSourceAgent(["read_file"]), {
        validationContext: {
          toolExists: (n) => toolRegistry.has(n),
          toolAllowedForSource: (n, s) => toolRegistry.allowed(n, s),
        },
      }),
    )
    expect(info.name).toBe("rogue-agent")
  })

  it("ValidationError thrown synchronously also carries the right code", () => {
    const err = new ValidationError(
      "TOOL_NOT_PERMITTED_FOR_SOURCE",
      "test message",
      { tool: "delete_resume", source: "user" },
    )
    expect(err.code).toBe("TOOL_NOT_PERMITTED_FOR_SOURCE")
    expect(err.message).toContain("[TOOL_NOT_PERMITTED_FOR_SOURCE]")
  })
})
