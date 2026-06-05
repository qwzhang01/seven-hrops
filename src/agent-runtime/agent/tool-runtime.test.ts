/**
 * Tests for the ToolRuntime module.
 *
 * Covers: stepCountIs, stream with mock model adapter, text accumulation,
 * tool call dispatch, multi-step loop, stop conditions, error handling
 */

import { describe, it, expect, vi } from "vitest"
import { Effect, Stream } from "effect"
import {
  ToolRuntime,
  stepCountIs,
  type ToolDefinition,
  type ModelAdapter,
  type LLMStreamEvent,
} from "../agent/tool-runtime"

// ─── Mock Model Adapter ──────────────────────────────────────────────

function createMockAdapter(responses: LLMStreamEvent[][]): ModelAdapter {
  let callIndex = 0
  return {
    stream: () => {
      const events = responses[callIndex++] ?? [{ type: "finish" as const, reason: "stop" }]
      return Stream.fromIterable(events)
    },
  }
}

// ─── Pure function tests ─────────────────────────────────────────────

describe("ToolRuntime — stepCountIs", () => {
  it("returns true when step + 1 >= count", () => {
    expect(stepCountIs(3)({ step: 2, maxSteps: 50 })).toBe(true)
    expect(stepCountIs(3)({ step: 3, maxSteps: 50 })).toBe(true)
  })

  it("returns false when step + 1 < count", () => {
    expect(stepCountIs(3)({ step: 0, maxSteps: 50 })).toBe(false)
    expect(stepCountIs(3)({ step: 1, maxSteps: 50 })).toBe(false)
  })
})

// ─── Stream tests ────────────────────────────────────────────────────

describe("ToolRuntime — stream", () => {
  const echoTool: ToolDefinition = {
    name: "echo",
    description: "Echo back the input",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    execute: async (args) => ({ echoed: args.text }),
  }

  it("streams text-delta events from the model", async () => {
    const adapter = createMockAdapter([
      [
        { type: "text-delta", text: "Hello " },
        { type: "text-delta", text: "world" },
        { type: "finish", reason: "stop" },
      ],
    ])

    const events: LLMStreamEvent[] = []
    await Effect.runPromise(
      Stream.runForEach(
        ToolRuntime.stream({ messages: [{ role: "user", content: "hi" }], tools: [], model: adapter }),
        (event) => Effect.sync(() => events.push(event)),
      ),
    )

    const textDeltas = events.filter((e) => e.type === "text-delta")
    expect(textDeltas).toHaveLength(2)
    expect((textDeltas[0] as any).text).toBe("Hello ")
    expect((textDeltas[1] as any).text).toBe("world")
  })

  it("handles a single tool call and loops back", async () => {
    const adapter = createMockAdapter([
      [
        { type: "tool-call", id: "call-1", name: "echo", input: { text: "test" } },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", text: "Done" },
        { type: "finish", reason: "stop" },
      ],
    ])

    const events: LLMStreamEvent[] = []
    await Effect.runPromise(
      Stream.runForEach(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "echo test" }],
          tools: [echoTool],
          model: adapter,
        }),
        (event) => Effect.sync(() => events.push(event)),
      ),
    )

    const types = events.map((e) => e.type)
    expect(types).toContain("tool-call")
    expect(types).toContain("tool-result")
    expect(types).toContain("text-delta")
    expect(types.filter((t) => t === "finish")).toHaveLength(2)

    const result = events.find((e) => e.type === "tool-result") as any
    expect(result.result).toEqual({ echoed: "test" })
  })

  it("dispatches collected tool calls even when provider finish reason is not tool-calls", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const adapter = createMockAdapter([
      [
        { type: "tool-call", id: "call-stop", name: "echo", input: { text: "from-stop" } },
        { type: "finish", reason: "stop" },
      ],
    ])

    const events: LLMStreamEvent[] = []
    await Effect.runPromise(
      Stream.runForEach(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "echo from-stop" }],
          tools: [echoTool],
          model: adapter,
          stopWhen: stepCountIs(1),
        }),
        (event) => Effect.sync(() => events.push(event)),
      ),
    )

    const result = events.find((e) => e.type === "tool-result") as
      | Extract<LLMStreamEvent, { type: "tool-result" }>
      | undefined
    expect(result).toBeDefined()
    expect(result).toMatchObject({
      type: "tool-result",
      id: "call-stop",
      name: "echo",
      result: { echoed: "from-stop" },
    })
    expect(warnSpy).toHaveBeenCalledWith(
      "[ToolRuntime] dispatching 1 collected tool-call(s) despite finishReason=stop",
    )
    warnSpy.mockRestore()
  })

  it("times out a hanging tool and emits tool-error plus tool-result", async () => {
    const hangingTool: ToolDefinition = {
      name: "hang_tool",
      description: "Never resolves",
      parameters: { type: "object", properties: {} },
      execute: async () => new Promise(() => {}),
    }
    const adapter = createMockAdapter([
      [
        { type: "tool-call", id: "call-hang", name: "hang_tool", input: {} },
        { type: "finish", reason: "tool-calls" },
      ],
    ])

    const events: LLMStreamEvent[] = []
    await Effect.runPromise(
      Stream.runForEach(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "hang" }],
          tools: [hangingTool],
          model: adapter,
          stopWhen: stepCountIs(1),
          toolTimeoutMs: 5,
        }),
        (event) => Effect.sync(() => events.push(event)),
      ),
    )

    const toolError = events.find((e) => e.type === "tool-error") as
      | Extract<LLMStreamEvent, { type: "tool-error" }>
      | undefined
    expect(toolError?.message).toContain('Tool "hang_tool" timed out after 5ms')

    const toolResult = events.find((e) => e.type === "tool-result") as
      | Extract<LLMStreamEvent, { type: "tool-result" }>
      | undefined
    expect(toolResult).toMatchObject({
      type: "tool-result",
      id: "call-hang",
      name: "hang_tool",
      result: null,
      error: 'Tool "hang_tool" timed out after 5ms',
    })
  })

  it("handles tool execution errors and emits tool-error event", async () => {
    const failTool: ToolDefinition = {
      name: "fail_tool",
      description: "Always fails",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        throw new Error("Tool execution failed")
      },
    }

    const adapter = createMockAdapter([
      [
        { type: "tool-call", id: "call-1", name: "fail_tool", input: {} },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", text: "Recovered" },
        { type: "finish", reason: "stop" },
      ],
    ])

    const events: LLMStreamEvent[] = []
    await Effect.runPromise(
      Stream.runForEach(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "fail" }],
          tools: [failTool],
          model: adapter,
        }),
        (event) => Effect.sync(() => events.push(event)),
      ),
    )

    const types = events.map((e) => e.type)
    expect(types).toContain("tool-error")
    expect(types).toContain("tool-result")

    const toolError = events.find((e) => e.type === "tool-error") as any
    expect(toolError.message).toContain("Tool execution failed")
  })

  it("stops at maxSteps", async () => {
    // Create adapter that always returns tool calls
    const infiniteToolCallAdapter: ModelAdapter = {
      stream: () =>
        Stream.fromIterable([
          { type: "tool-call" as const, id: `call-${Date.now()}`, name: "echo", input: { text: "loop" } },
          { type: "finish" as const, reason: "tool-calls" },
        ]),
    }

    const events: LLMStreamEvent[] = []
    await Effect.runPromise(
      Stream.runForEach(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "loop" }],
          tools: [echoTool],
          model: infiniteToolCallAdapter,
          maxSteps: 2,
        }),
        (event) => Effect.sync(() => events.push(event)),
      ),
    )

    // Should stop after maxSteps
    const finishEvents = events.filter((e) => e.type === "finish")
    expect(finishEvents.length).toBeLessThanOrEqual(3)
  })

  it("handles unknown tool gracefully", async () => {
    const adapter = createMockAdapter([
      [
        { type: "tool-call", id: "call-1", name: "unknown_tool", input: {} },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text-delta", text: "Tool not found" },
        { type: "finish", reason: "stop" },
      ],
    ])

    const events: LLMStreamEvent[] = []
    await Effect.runPromise(
      Stream.runForEach(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "unknown" }],
          tools: [], // No tools registered
          model: adapter,
        }),
        (event) => Effect.sync(() => events.push(event)),
      ),
    )

    const toolError = events.find((e) => e.type === "tool-error") as any
    expect(toolError.message).toContain("Unknown tool")
  })

  it("respects custom stopWhen condition", async () => {
    const adapter = createMockAdapter([
      [
        { type: "text-delta", text: "Step 0" },
        { type: "finish", reason: "stop" },
      ],
    ])

    const events: LLMStreamEvent[] = []
    await Effect.runPromise(
      Stream.runForEach(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "test" }],
          tools: [],
          model: adapter,
          stopWhen: stepCountIs(1),
        }),
        (event) => Effect.sync(() => events.push(event)),
      ),
    )

    const finishEvents = events.filter((e) => e.type === "finish")
    expect(finishEvents).toHaveLength(1)
  })
})
