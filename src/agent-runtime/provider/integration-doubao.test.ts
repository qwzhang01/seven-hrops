/**
 * runtime-multimodel-protocol-adapter / 阶段 11 — Doubao 集成回归测试。
 *
 * 守住的不变量是"豆包 prompt-style tool-call 端到端打通"——这是本变更立项的
 * 原始触发器（参 [proposal.md](../../../openspec/changes/runtime-multimodel-protocol-adapter/proposal.md)）。
 *
 * ## 测试粒度
 *
 * **协议链路集成**（不走 fetch）：
 *
 * ```
 * mock TextStreamPart[]   ← 模拟 @ai-sdk/openai-compatible 已经把豆包 SSE 解出
 *         ↓
 * withPromptStyleToolCall(ProtocolAdapters["openai-compatible"], "doubao")
 *         ↓ Stream<LLMStreamEvent, Error>
 * 包成 ModelAdapter
 *         ↓
 * ToolRuntime.stream({ tools, model, stopWhen: stepCountIs(1) })
 *         ↓
 * 断言 ToolDefinition.execute 被以正确入参调用 + emit tool-result
 * ```
 *
 * 这一粒度同时覆盖：
 * 1. ProtocolAdapter 链路的 `<|FunctionCallBegin|>...<|FunctionCallEnd|>` 解析；
 * 2. 跨 chunk 边界（拆分 token）情况下不漏字节；
 * 3. ToolRuntime 接管 dispatch（**不**让 Provider 自己执行）——arch-runtime-single-loop 守卫；
 * 4. follow-up 在 `stopWhen: stepCountIs(1)` 下被正确截断（不进入第二步 LLM 调用）。
 *
 * **不走 fetch / 不走 streamText**：阶段 11 的目标是回归守卫，全链路 fetch mock
 * 易脆且不能更精确地暴露真实问题；具名 plugin 与 streamText 的接缝由 single-loop.test.ts
 * 的 declaration-only 转换测试 + integration-anthropic.test.ts 的 ToolRuntime 集成
 * 共同覆盖，已足够。
 */

import { describe, it, expect, vi } from "vitest"
import { Effect, Stream } from "effect"
import type { TextStreamPart } from "ai"
import { ProtocolAdapters, withPromptStyleToolCall } from "./protocols/index"
import {
  ToolRuntime,
  type ToolDefinition,
  type ModelAdapter,
  type LLMStreamEvent,
} from "../agent/tool-runtime"
import { mockTextStreamPartIterable } from "./protocols/_protocol-test-utils"
import { REAL_DOUBAO_TOOL_CALL_PAYLOAD } from "./__fixtures__/doubao-real"

// ─── helper：用真实 ProtocolAdapter 包装成 ModelAdapter ────────────────

/**
 * 把"mock TextStreamPart 数组 + 真实 ProtocolAdapter"组合成 ToolRuntime 能消费
 * 的 ModelAdapter。
 *
 * 关键点：每次 `model.stream(...)` 调用都重新构造 AsyncIterable——因为 Effect
 * Stream 在被 ToolRuntime 多次 collect 时不能复用同一个 iterator（已耗尽）。
 * follow-up 步骤会再次调 model.stream，必须 fresh stream。
 */
function makeDoubaoAdapter(
  partsPerStep: ReadonlyArray<ReadonlyArray<TextStreamPart<Record<string, never>>>>,
): ModelAdapter {
  const inner = ProtocolAdapters["openai-compatible"]
  const decorated = withPromptStyleToolCall(inner, "doubao")
  let stepIdx = 0
  return {
    stream: () => {
      const parts = partsPerStep[stepIdx++] ?? []
      return decorated.transform(mockTextStreamPartIterable(parts))
    },
  }
}

// ─── Case A: 单工具调用端到端打通 ─────────────────────────────────────

describe("integration-doubao / single tool call end-to-end", () => {
  it("ProtocolAdapter 解出 tool-call → ToolRuntime 调用 execute → emit tool-result", async () => {
    const executeSpy = vi.fn(async (args: Record<string, unknown>) => ({
      echoed: args.text,
    }))
    const echoTool: ToolDefinition = {
      name: "echo",
      description: "Echo back the input",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      execute: executeSpy,
    }

    // 模拟豆包 SSE 解出后的 raw TextStreamPart 序列：
    // 1. text-start
    // 2. text-delta —— 内嵌 prompt-style tool-call 编码
    // 3. text-end
    // 4. finish
    const adapter = makeDoubaoAdapter([
      [
        { type: "text-start", id: "txt-1" } as TextStreamPart<Record<string, never>>,
        {
          type: "text-delta",
          id: "txt-1",
          text: '<|FunctionCallBegin|>{"name":"echo","arguments":{"text":"hello doubao"}}<|FunctionCallEnd|>',
        } as TextStreamPart<Record<string, never>>,
        { type: "text-end", id: "txt-1" } as TextStreamPart<Record<string, never>>,
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
          messages: [{ role: "user", content: "echo hello doubao" }],
          tools: [echoTool],
          model: adapter,
          stopWhen: ToolRuntime.stepCountIs(1),
        }),
        (event) =>
          Effect.sync(() => {
            events.push(event)
          }),
      ),
    )

    // 1. tool 被调用一次，入参正确
    expect(executeSpy).toHaveBeenCalledTimes(1)
    expect(executeSpy).toHaveBeenCalledWith({ text: "hello doubao" })

    // 2. 事件序列含 tool-call + tool-result
    const toolCallEvents = events.filter((e) => e.type === "tool-call")
    const toolResultEvents = events.filter((e) => e.type === "tool-result")
    expect(toolCallEvents).toHaveLength(1)
    expect(toolResultEvents).toHaveLength(1)
    expect(toolCallEvents[0]).toMatchObject({
      type: "tool-call",
      name: "echo",
      input: { text: "hello doubao" },
    })
    // tool-call.id 由 prompt-style 装饰器合成（ps-${Date.now()}-${rand}），仅断格式
    expect((toolCallEvents[0] as { id: string }).id).toMatch(/^ps-\d+-[a-z0-9]+$/)

    // 3. tool-result.result 透传 ToolDefinition.execute 返回值
    expect(toolResultEvents[0]).toMatchObject({
      type: "tool-result",
      name: "echo",
      result: { echoed: "hello doubao" },
    })

    // 4. tool-call.id 与 tool-result.id 必须严格相等（dispatch 配对契约）
    expect((toolResultEvents[0] as { id: string }).id).toBe(
      (toolCallEvents[0] as { id: string }).id,
    )
  })
})

// ─── Case B: 跨 chunk 边界拆分 token 不漏字节 ─────────────────────────

describe("integration-doubao / cross-chunk token boundary", () => {
  it("把 prompt-style begin/end token 拆到 3 个 text-delta 仍能正确解析", async () => {
    const executeSpy = vi.fn(async (args: Record<string, unknown>) => ({
      result: args,
    }))
    const tool: ToolDefinition = {
      name: "search",
      description: "Search",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      execute: executeSpy,
    }

    // 把豆包编码 `<|FunctionCallBegin|>{"name":"search","arguments":{"query":"x"}}<|FunctionCallEnd|>`
    // 故意拆成 3 段，每段都横跨 begin/end token 内部——这是 prompt-style 装饰器
    // 状态机最容易出错的边界。
    const fullPayload =
      '<|FunctionCallBegin|>{"name":"search","arguments":{"query":"x"}}<|FunctionCallEnd|>'
    const cut1 = "<|FunctionC" // 11 chars — token 中段
    const cut2 = 'allBegin|>{"name":"search","arguments":{"query":"x"}}<|FunctionCa'
    const cut3 = "llEnd|>"
    expect(cut1 + cut2 + cut3).toBe(fullPayload)

    const adapter = makeDoubaoAdapter([
      [
        { type: "text-start", id: "txt-1" } as TextStreamPart<Record<string, never>>,
        { type: "text-delta", id: "txt-1", text: cut1 } as TextStreamPart<
          Record<string, never>
        >,
        { type: "text-delta", id: "txt-1", text: cut2 } as TextStreamPart<
          Record<string, never>
        >,
        { type: "text-delta", id: "txt-1", text: cut3 } as TextStreamPart<
          Record<string, never>
        >,
        { type: "text-end", id: "txt-1" } as TextStreamPart<Record<string, never>>,
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
          messages: [{ role: "user", content: "search x" }],
          tools: [tool],
          model: adapter,
          stopWhen: ToolRuntime.stepCountIs(1),
        }),
        (event) =>
          Effect.sync(() => {
            events.push(event)
          }),
      ),
    )

    // 1. tool 仍被精确调用（跨 chunk 不漏不错）
    expect(executeSpy).toHaveBeenCalledTimes(1)
    expect(executeSpy).toHaveBeenCalledWith({ query: "x" })

    // 2. 没有任何 text-delta 事件携带 token 残片（说明状态机正确吃掉所有 token 字节）
    const textEvents = events.filter((e) => e.type === "text-delta") as Array<{
      type: "text-delta"
      text: string
    }>
    for (const e of textEvents) {
      expect(e.text).not.toContain("<|FunctionCall")
      expect(e.text).not.toContain("Begin|>")
      expect(e.text).not.toContain("End|>")
    }
  })
})

// ─── Case C: single-loop 守卫（stopWhen=1 下不进入 follow-up）──────────

describe("integration-doubao / single-loop guard", () => {
  it("stopWhen=stepCountIs(1) 时，model.stream 仅被调用 1 次（不进入 follow-up LLM 调用）", async () => {
    const tool: ToolDefinition = {
      name: "noop",
      description: "no op",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    }

    let streamCallCount = 0
    const innerAdapter = ProtocolAdapters["openai-compatible"]
    const decorated = withPromptStyleToolCall(innerAdapter, "doubao")
    const adapter: ModelAdapter = {
      stream: () => {
        streamCallCount++
        return decorated.transform(
          mockTextStreamPartIterable([
            { type: "text-start", id: "t" } as TextStreamPart<Record<string, never>>,
            {
              type: "text-delta",
              id: "t",
              text: '<|FunctionCallBegin|>{"name":"noop","arguments":{}}<|FunctionCallEnd|>',
            } as TextStreamPart<Record<string, never>>,
            { type: "text-end", id: "t" } as TextStreamPart<Record<string, never>>,
            {
              type: "finish-step",
              finishReason: "tool-calls",
            } as unknown as TextStreamPart<Record<string, never>>,
          ]),
        )
      },
    }

    await Effect.runPromise(
      Stream.runDrain(
        ToolRuntime.stream({
          messages: [{ role: "user", content: "noop" }],
          tools: [tool],
          model: adapter,
          stopWhen: ToolRuntime.stepCountIs(1),
        }),
      ),
    )

    // 单步退出：stopWhen=stepCountIs(1) 在第一次 step 后立即停，
    // 不会进入 follow-up step 拉第二次 LLM 流。
    expect(streamCallCount).toBe(1)
  })
})

// ─── Case D: 真机锚点（real-machine fixture / 豆包真机字节级复刻） ───────

/**
 * 该 case 的 fixture 字节级复刻自 [`__fixtures__/doubao-real.ts`](./__fixtures__/doubao-real.ts)。
 *
 * 守住「真机 fixture 锚点」纪律（来源：[`runtime-multimodel-real-machine-verification`](
 * ../../../openspec/changes/runtime-multimodel-real-machine-verification/specs/platform-foundation/spec.md)
 * 跨层契约纪律 3.2 子条目）：
 *
 * - 任何修改 `parseToolCalls` 形态兼容性的 PR 都会在该 case 被 CI 守住——
 *   破坏豆包真机解析的 PR 立即变红，避免重蹈「自造 fixture 全绿但真机失败」覆辙。
 * - case 描述中的 "real-machine fixture" 字样用于 grep 审计（确认每个 prompt-style
 *   provider 都至少有一条真机锚点 case）。
 */
describe("integration-doubao / real-machine fixture (doubao)", () => {
  it("豆包真机数组+parameters payload 端到端打通 (real-machine fixture)", async () => {
    // 形态校验前置断言：守住"fixture 文件不被悄悄改写"。
    expect(REAL_DOUBAO_TOOL_CALL_PAYLOAD).toContain("<|FunctionCallBegin|>")
    expect(REAL_DOUBAO_TOOL_CALL_PAYLOAD).toContain("<|FunctionCallEnd|>")
    expect(REAL_DOUBAO_TOOL_CALL_PAYLOAD).toContain('"parameters"')
    expect(REAL_DOUBAO_TOOL_CALL_PAYLOAD).not.toContain('"arguments"') // 真机豆包用 parameters
    // 顶层是 array（拆掉首尾 token 后第一个非空字符是 '['）
    const inner = REAL_DOUBAO_TOOL_CALL_PAYLOAD.replace(
      "<|FunctionCallBegin|>",
      "",
    ).replace("<|FunctionCallEnd|>", "")
    expect(inner.trimStart().startsWith("[")).toBe(true)

    const executeSpy = vi.fn(async (args: Record<string, unknown>) => {
      const path = typeof args.path === "string" ? args.path : args.dir_path
      if (typeof path !== "string") {
        throw new Error("list_dir requires path")
      }
      return {
        entries: ["resume_alice.pdf", "resume_bob.pdf"],
        args,
        normalizedPath: path,
      }
    })
    const listDirTool: ToolDefinition = {
      name: "list_dir",
      description: "List directory entries",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      execute: executeSpy,
    }

    const adapter = makeDoubaoAdapter([
      [
        { type: "text-start", id: "t-real" } as TextStreamPart<Record<string, never>>,
        {
          type: "text-delta",
          id: "t-real",
          text: REAL_DOUBAO_TOOL_CALL_PAYLOAD,
        } as TextStreamPart<Record<string, never>>,
        { type: "text-end", id: "t-real" } as TextStreamPart<Record<string, never>>,
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
          messages: [{ role: "user", content: "list 01_inputs" }],
          tools: [listDirTool],
          model: adapter,
          stopWhen: ToolRuntime.stepCountIs(1),
        }),
        (event) =>
          Effect.sync(() => {
            events.push(event)
          }),
      ),
    )

    // 1. 真机 parameters 字段被正确识别为 raw input（豆包真实字段仍是 dir_path）
    expect(executeSpy).toHaveBeenCalledTimes(1)
    expect(executeSpy).toHaveBeenCalledWith({ dir_path: "01_inputs/" })

    // 2. 顶层数组中的单条 tool-call 被正确 emit（数组容器不应导致漏检或重复）
    const toolCallEvents = events.filter((e) => e.type === "tool-call")
    expect(toolCallEvents).toHaveLength(1)
    expect(toolCallEvents[0]).toMatchObject({
      type: "tool-call",
      name: "list_dir",
      input: { dir_path: "01_inputs/" },
    })

    // 3. tool-result.result 透传 ToolDefinition.execute 返回值；真实 list_dir schema 暴露 path，
    //    但豆包真机给 dir_path，工具执行边界必须兼容并归一化。
    const toolResultEvents = events.filter((e) => e.type === "tool-result")
    expect(toolResultEvents).toHaveLength(1)
    expect(toolResultEvents[0]).toMatchObject({
      type: "tool-result",
      name: "list_dir",
      result: {
        normalizedPath: "01_inputs/",
      },
    })

    // 4. 没有任何 text-delta 携带 prompt-style token 残片
    const textOut = events
      .filter((e) => e.type === "text-delta")
      .map((e) => (e.type === "text-delta" ? e.text : ""))
      .join("")
    expect(textOut).not.toContain("<|FunctionCall")
    expect(textOut).not.toContain("Begin|>")
    expect(textOut).not.toContain("End|>")
  })
})
