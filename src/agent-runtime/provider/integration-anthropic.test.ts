/**
 * runtime-multimodel-protocol-adapter / 阶段 11 — Anthropic Messages 集成回归测试。
 *
 * 与 [`integration-doubao.test.ts`](./integration-doubao.test.ts) 同结构：
 * 协议链路集成（不走 fetch / 不走 streamText），守住 Anthropic Messages 协议
 * tool_use 事件链路从 ProtocolAdapter 直至 ToolRuntime.dispatch 的端到端通路。
 *
 * ## 与 Doubao 集成的差异
 *
 * - **不需要 prompt-style 装饰器**：Anthropic 协议原生支持 `tool-call` event，
 *   `@ai-sdk/anthropic` 已把 `tool_use` block 解为 TextStreamPart.tool-call。
 * - **finishReason 归一化**：Anthropic 实际 stop_reason 是 `"tool_use"`，但
 *   ToolRuntime（[tool-runtime.ts:183](../agent/tool-runtime.ts)）硬编码只识别
 *   `"tool-calls"` 才进 dispatch 分支——本测试中 mock 端先归一化为 `"tool-calls"`，
 *   等价于 AI SDK 已经做了协议翻译。
 *
 * > **NOTE**：Anthropic 真实 finishReason `"tool_use"` 与 ToolRuntime 期待的
 * > `"tool-calls"` 不一致是潜在 bug——本变更不引入此修复（不在 scope 内），
 * > 后续可独立提 OpenSpec change `runtime-finishreason-normalization`。
 */

import { describe, it, expect, vi } from "vitest"
import { Effect, Stream } from "effect"
import type { TextStreamPart } from "ai"
import { ProtocolAdapters } from "./protocols/index"
import {
  ToolRuntime,
  type ToolDefinition,
  type ModelAdapter,
  type LLMStreamEvent,
} from "../agent/tool-runtime"
import { mockTextStreamPartIterable } from "./protocols/_protocol-test-utils"

// ─── helper：用 anthropic-messages adapter 包装成 ModelAdapter ────────

function makeAnthropicAdapter(
  partsPerStep: ReadonlyArray<ReadonlyArray<TextStreamPart<Record<string, never>>>>,
): ModelAdapter {
  const adapter = ProtocolAdapters["anthropic-messages"]
  let stepIdx = 0
  return {
    stream: () => {
      const parts = partsPerStep[stepIdx++] ?? []
      return adapter.transform(mockTextStreamPartIterable(parts))
    },
  }
}

// ─── Case A: 单 tool_use 端到端打通 ───────────────────────────────────

describe("integration-anthropic / single tool_use end-to-end", () => {
  it("ProtocolAdapter 直接 emit tool-call → ToolRuntime 调用 execute → emit tool-result", async () => {
    const executeSpy = vi.fn(async (args: Record<string, unknown>) => ({
      celsius: 24,
      query: args.query,
    }))
    const weatherTool: ToolDefinition = {
      name: "get_weather",
      description: "Get current weather for a location",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      execute: executeSpy,
    }

    // 模拟 @ai-sdk/anthropic 已把 Anthropic SSE block 解为 TextStreamPart：
    // 1. text-delta —— Claude 的解释性输出
    // 2. tool-call —— 对应 Anthropic content block 中的 tool_use block
    // 3. finish-step —— 注意 mock 中归一化为 "tool-calls"（见文件头 NOTE）
    const adapter = makeAnthropicAdapter([
      [
        {
          type: "text-delta",
          text: "Let me check the weather.",
        } as unknown as TextStreamPart<Record<string, never>>,
        {
          type: "tool-call",
          toolCallId: "toolu_01ABC",
          toolName: "get_weather",
          input: { query: "Beijing" },
        } as unknown as TextStreamPart<Record<string, never>>,
        {
          type: "finish-step",
          finishReason: "tool-calls",
        } as unknown as TextStreamPart<Record<string, never>>,
      ],
    ])

    const events: LLMStreamEvent[] = []
    await Effect.runPromise(
      Stream.runForEach(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "What's the weather in Beijing?" }],
          tools: [weatherTool],
          model: adapter,
          stopWhen: ToolRuntime.stepCountIs(1),
        }),
        (event) =>
          Effect.sync(() => {
            events.push(event)
          }),
      ),
    )

    // 1. Anthropic 原生 tool_use 链路打通——execute 被精确调用
    expect(executeSpy).toHaveBeenCalledTimes(1)
    expect(executeSpy).toHaveBeenCalledWith({ query: "Beijing" })

    // 2. tool-call.id 来自 Anthropic 的 toolu_xxx（与豆包合成 id 不同——这是
    //    协议差异化的体现）
    const toolCallEvents = events.filter((e) => e.type === "tool-call")
    expect(toolCallEvents).toHaveLength(1)
    expect(toolCallEvents[0]).toMatchObject({
      type: "tool-call",
      id: "toolu_01ABC",
      name: "get_weather",
      input: { query: "Beijing" },
    })

    // 3. tool-result 配对正确，结果透传
    const toolResultEvents = events.filter((e) => e.type === "tool-result")
    expect(toolResultEvents).toHaveLength(1)
    expect(toolResultEvents[0]).toMatchObject({
      type: "tool-result",
      id: "toolu_01ABC",
      name: "get_weather",
      result: { celsius: 24, query: "Beijing" },
    })

    // 4. text-delta 在 tool-call 之前正常透传（Claude 的"思考"性输出不丢）
    const textEvents = events.filter((e) => e.type === "text-delta")
    expect(textEvents).toHaveLength(1)
    expect(textEvents[0]).toMatchObject({
      type: "text-delta",
      text: "Let me check the weather.",
    })
  })
})

// ─── Case B: 并发多 tool_use 全部 dispatch ────────────────────────────

describe("integration-anthropic / parallel tool_use dispatch", () => {
  it("一个 step 内多个 tool-call 全部被 dispatch，结果按 id 对齐", async () => {
    const calcSpy = vi.fn(async (args: Record<string, unknown>) => ({
      sum: (args.a as number) + (args.b as number),
    }))
    const calcTool: ToolDefinition = {
      name: "calc",
      description: "Add two numbers",
      parameters: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
      execute: calcSpy,
    }

    const adapter = makeAnthropicAdapter([
      [
        {
          type: "tool-call",
          toolCallId: "toolu_X1",
          toolName: "calc",
          input: { a: 1, b: 2 },
        } as unknown as TextStreamPart<Record<string, never>>,
        {
          type: "tool-call",
          toolCallId: "toolu_X2",
          toolName: "calc",
          input: { a: 10, b: 20 },
        } as unknown as TextStreamPart<Record<string, never>>,
        {
          type: "finish-step",
          finishReason: "tool-calls",
        } as unknown as TextStreamPart<Record<string, never>>,
      ],
    ])

    const events: LLMStreamEvent[] = []
    await Effect.runPromise(
      Stream.runForEach(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "calc 1+2 and 10+20" }],
          tools: [calcTool],
          model: adapter,
          stopWhen: ToolRuntime.stepCountIs(1),
        }),
        (event) =>
          Effect.sync(() => {
            events.push(event)
          }),
      ),
    )

    // 1. 两次调用都发生
    expect(calcSpy).toHaveBeenCalledTimes(2)
    expect(calcSpy).toHaveBeenCalledWith({ a: 1, b: 2 })
    expect(calcSpy).toHaveBeenCalledWith({ a: 10, b: 20 })

    // 2. 两个 tool-result 按 id 配对，无错位
    const resultsById = new Map<string, unknown>()
    for (const e of events) {
      if (e.type === "tool-result") {
        resultsById.set(e.id, e.result)
      }
    }
    expect(resultsById.get("toolu_X1")).toEqual({ sum: 3 })
    expect(resultsById.get("toolu_X2")).toEqual({ sum: 30 })
  })
})

// ─── Case C: 三个 ProtocolAdapter 同构性（端到端层面）─────────────────

describe("integration-anthropic / contract: 三 protocol 端到端等价", () => {
  it("相同 raw stream 喂给 anthropic / openai-native / openai-compatible，ToolRuntime 行为一致", async () => {
    const sharedSpy = (id: string) =>
      vi.fn(async () => ({ from: id }))

    const tool = (spy: ReturnType<typeof vi.fn>): ToolDefinition => ({
      name: "ping",
      description: "ping",
      parameters: { type: "object", properties: {} },
      execute: spy,
    })

    const baseInputs: TextStreamPart<Record<string, never>>[] = [
      {
        type: "tool-call",
        toolCallId: "shared-001",
        toolName: "ping",
        input: {},
      } as unknown as TextStreamPart<Record<string, never>>,
      {
        type: "finish-step",
        finishReason: "tool-calls",
      } as unknown as TextStreamPart<Record<string, never>>,
    ]

    async function run(adapterID: keyof typeof ProtocolAdapters) {
      const spy = sharedSpy(adapterID)
      const proto = ProtocolAdapters[adapterID]
      const model: ModelAdapter = {
        stream: () => proto.transform(mockTextStreamPartIterable(baseInputs)),
      }
      const events: LLMStreamEvent[] = []
      await Effect.runPromise(
        Stream.runForEach(
          ToolRuntime.stream({
            messages: [{ role: "user", content: "go" }],
            tools: [tool(spy)],
            model,
            stopWhen: ToolRuntime.stepCountIs(1),
          }),
          (event) =>
            Effect.sync(() => {
              events.push(event)
            }),
        ),
      )
      return { events, callCount: spy.mock.calls.length }
    }

    const a = await run("anthropic-messages")
    const n = await run("openai-native")
    const c = await run("openai-compatible")

    // 三个 adapter 在 ToolRuntime 视角下行为完全等价
    expect(a.callCount).toBe(1)
    expect(n.callCount).toBe(1)
    expect(c.callCount).toBe(1)
    expect(a.events.map((e) => e.type)).toEqual(n.events.map((e) => e.type))
    expect(a.events.map((e) => e.type)).toEqual(c.events.map((e) => e.type))
  })
})
