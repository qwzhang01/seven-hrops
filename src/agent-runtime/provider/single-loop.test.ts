/**
 * Tests for the arch-runtime-single-loop contract.
 *
 * These tests guard the architectural invariant introduced by the
 * `arch-runtime-single-loop` change: ToolRuntime is the ONLY agentic loop;
 * Provider/ModelAdapter MUST emit raw tool-call events without executing tools.
 *
 * See:
 *   - openspec/changes/arch-runtime-single-loop/proposal.md
 *   - openspec/changes/arch-runtime-single-loop/specs/tool-registry/spec.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Effect, Stream } from "effect"
import { __internal as providerInternals } from "./index"
import {
  ToolRuntime,
  type ToolDefinition,
  type ModelAdapter,
  type LLMStreamEvent,
} from "../agent/tool-runtime"

// ─── Case A: Provider passes declaration-only tools to AI SDK ────────

describe("arch-runtime-single-loop / Provider declaration-only conversion", () => {
  const echoTool: ToolDefinition = {
    name: "echo",
    description: "Echo back the input",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    execute: async (args) => ({ echoed: args.text }),
  }

  it("strips `execute` from tools handed to the AI SDK", () => {
    const aiSdkTools = providerInternals.convertToAiSdkToolsForDeclarationOnly([echoTool])

    expect(aiSdkTools).toHaveProperty("echo")
    const echo = aiSdkTools.echo as Record<string, unknown>
    expect(echo.description).toBe("Echo back the input")
    expect(echo.inputSchema).toBeDefined()
    // CRITICAL: declaration-only — no `execute`
    expect(echo).not.toHaveProperty("execute")
  })

  it("does not invoke the original tool.execute during conversion", async () => {
    const executeSpy = vi.fn(async (args: Record<string, unknown>) => ({ ok: true, args }))
    const tool: ToolDefinition = {
      name: "spy",
      description: "Spy tool",
      parameters: { type: "object", properties: {} },
      execute: executeSpy,
    }

    const aiSdkTools = providerInternals.convertToAiSdkToolsForDeclarationOnly([tool])

    // The conversion is purely structural; execute must never be touched here.
    expect(executeSpy).not.toHaveBeenCalled()
    // And no `execute` field is exposed for the SDK to call later.
    expect(aiSdkTools.spy).not.toHaveProperty("execute")
  })

  it("preserves description and inputSchema for every tool", () => {
    const tools: ToolDefinition[] = [
      {
        name: "alpha",
        description: "Alpha desc",
        parameters: { type: "object", properties: { a: { type: "string" } } },
        execute: async () => ({}),
      },
      {
        name: "beta",
        description: "Beta desc",
        parameters: { type: "object", properties: { b: { type: "number" } } },
        execute: async () => ({}),
      },
    ]
    const result = providerInternals.convertToAiSdkToolsForDeclarationOnly(tools)
    expect(Object.keys(result).sort()).toEqual(["alpha", "beta"])
    expect((result.alpha as { description: string }).description).toBe("Alpha desc")
    expect((result.beta as { description: string }).description).toBe("Beta desc")
    expect(result.alpha).not.toHaveProperty("execute")
    expect(result.beta).not.toHaveProperty("execute")
  })
})

// ─── Case B: ToolRuntime warns on duplicate tool-call.id ─────────────

describe("arch-runtime-single-loop / ToolRuntime duplicate tool-call.id guard", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  const echoTool: ToolDefinition = {
    name: "echo",
    description: "Echo back the input",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    execute: async (args) => ({ echoed: args.text }),
  }

  function adapterFromResponses(responses: LLMStreamEvent[][]): ModelAdapter {
    let i = 0
    return {
      stream: () => {
        const events = responses[i++] ?? [{ type: "finish" as const, reason: "stop" }]
        return Stream.fromIterable(events)
      },
    }
  }

  it("logs a warning when the same tool-call.id appears twice in one step", async () => {
    // Simulate a contract violation: a (bad) provider emits the same id twice
    // within a single LLM step. This is exactly the symptom of double-dispatch.
    const adapter = adapterFromResponses([
      [
        { type: "tool-call", id: "call-DUP", name: "echo", input: { text: "first" } },
        { type: "tool-call", id: "call-DUP", name: "echo", input: { text: "second" } },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "finish", reason: "stop" },
      ],
    ])

    await Effect.runPromise(
      Stream.runDrain(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "hi" }],
          tools: [echoTool],
          model: adapter,
        }),
      ),
    )

    // The defensive guard must have fired at least once with our diagnostic message.
    const warnCalls = warnSpy.mock.calls.flat().join(" ")
    expect(warnCalls).toContain("[ToolRuntime] duplicate tool-call.id")
    expect(warnCalls).toContain("call-DUP")
    expect(warnCalls).toContain("arch-runtime-single-loop")
  })

  it("does NOT warn when each tool-call.id is unique within a step", async () => {
    const adapter = adapterFromResponses([
      [
        { type: "tool-call", id: "call-1", name: "echo", input: { text: "a" } },
        { type: "tool-call", id: "call-2", name: "echo", input: { text: "b" } },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "finish", reason: "stop" },
      ],
    ])

    await Effect.runPromise(
      Stream.runDrain(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "hi" }],
          tools: [echoTool],
          model: adapter,
        }),
      ),
    )

    const dupWarn = warnSpy.mock.calls.find((args) =>
      args.some((a) => typeof a === "string" && a.includes("duplicate tool-call.id")),
    )
    expect(dupWarn).toBeUndefined()
  })

  it("does NOT warn across steps when ids legitimately repeat per step", async () => {
    // seenIds is per-step; the same id reused in a *new* step should not warn.
    // (In practice ids are usually unique per provider response, but verify the
    // guard isn't accidentally global.)
    const adapter = adapterFromResponses([
      [
        { type: "tool-call", id: "call-X", name: "echo", input: { text: "a" } },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "tool-call", id: "call-X", name: "echo", input: { text: "b" } },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "finish", reason: "stop" },
      ],
    ])

    await Effect.runPromise(
      Stream.runDrain(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "hi" }],
          tools: [echoTool],
          model: adapter,
        }),
      ),
    )

    const dupWarn = warnSpy.mock.calls.find((args) =>
      args.some((a) => typeof a === "string" && a.includes("duplicate tool-call.id")),
    )
    expect(dupWarn).toBeUndefined()
  })
})
