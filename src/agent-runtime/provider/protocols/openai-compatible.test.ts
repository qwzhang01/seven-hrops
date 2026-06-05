/**
 * `protocols/openai-compatible.test.ts`
 *
 * **任务 7.2**：openai-compatible ProtocolAdapter 的契约测试。
 *
 * 与 [`openai-native.test.ts`](./openai-native.test.ts) 形态一致——因为两者
 * 都通过 [`_shared.ts`](./_shared.ts) 的 `streamFromTextStreamParts` 装配，
 * stream 转换层完全同构。差异仅在 `protocolID` 与未来扩展空间。
 *
 * 本测试**显式断言**："openai-compatible 与 openai-native 在相同输入下产出
 * 相同 LLMStreamEvent 序列"——这是 spec.md 中两个 adapter 形态等价性的
 * contract test，防止未来某次重构在 openai-compatible 引入意外差异。
 *
 * ## 与 openai-native 的语义差异（仅在调用方体现）
 *
 * - openai-compatible 不暴露 reasoning-delta（compatible 厂商不实现 reasoning
 *   流）——但**这是 SDK 工厂决定的输入**，不是 adapter 转换决定的输出。本
 *   测试给 adapter 喂 reasoning-delta 时它仍然会按相同规则映射。这是合理的：
 *   adapter 是纯转换器，不预设输入合法性。
 */

import { describe, it, expect } from "vitest"
import type { TextStreamPart } from "ai"
import { OpenAICompatibleProtocol } from "./openai-compatible"
import { OpenAINativeProtocol } from "./openai-native"
import { collectAdapterEvents } from "./_protocol-test-utils"

type Part = TextStreamPart<Record<string, never>>

describe("OpenAICompatibleProtocol", () => {
  it("protocolID === 'openai-compatible'", () => {
    expect(OpenAICompatibleProtocol.protocolID).toBe("openai-compatible")
  })

  it("text-delta / tool-call / finish-step / error / abort 全套映射对齐", async () => {
    const events = await collectAdapterEvents(OpenAICompatibleProtocol, [
      { type: "text-delta", text: "hi" } as unknown as Part,
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "fn",
        input: { x: 1 },
      } as unknown as Part,
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "fn",
        output: "ok",
      } as unknown as Part,
      { type: "finish-step", finishReason: "stop" } as unknown as Part,
    ])
    expect(events).toEqual([
      { type: "text-delta", text: "hi" },
      { type: "tool-call", id: "c1", name: "fn", input: { x: 1 } },
      { type: "tool-result", id: "c1", name: "fn", result: "ok" },
      { type: "finish", reason: "stop" },
    ])
  })

  it("abort 视为正常 finish (reason='abort')", async () => {
    const events = await collectAdapterEvents(OpenAICompatibleProtocol, [
      { type: "text-delta", text: "partial" } as unknown as Part,
      { type: "abort" } as unknown as Part,
    ])
    expect(events).toEqual([
      { type: "text-delta", text: "partial" },
      { type: "finish", reason: "abort" },
    ])
  })

  it("contract: 与 OpenAINativeProtocol 在相同输入下产出相同事件序列", async () => {
    // 等价性 contract test——若任一 adapter 引入与对方不一致的转换规则，
    // 此测试 SHALL fail。这是阶段 7.2 spec 显式要求的回归守卫。
    const inputs: Part[] = [
      { type: "text-delta", text: "alpha" } as unknown as Part,
      { type: "reasoning-delta", text: "thinking" } as unknown as Part, // 给两边都喂
      {
        type: "tool-call",
        toolCallId: "tc-x",
        toolName: "calc",
        input: { a: 2, b: 3 },
      } as unknown as Part,
      {
        type: "tool-result",
        toolCallId: "tc-x",
        toolName: "calc",
        output: 5,
      } as unknown as Part,
      { type: "text-delta", text: "= 5" } as unknown as Part,
      { type: "finish-step", finishReason: "stop" } as unknown as Part,
    ]
    const compatibleEvents = await collectAdapterEvents(
      OpenAICompatibleProtocol,
      inputs,
    )
    const nativeEvents = await collectAdapterEvents(
      OpenAINativeProtocol,
      inputs,
    )
    expect(compatibleEvents).toEqual(nativeEvents)
  })

  it("error part 正常透传 error 字段", async () => {
    const events = await collectAdapterEvents(OpenAICompatibleProtocol, [
      { type: "error", error: new Error("api 500") } as unknown as Part,
    ])
    expect(events).toHaveLength(1)
    const evt = events[0]
    if (evt.type !== "error") throw new Error("expected error event")
    expect((evt.error as Error).message).toBe("api 500")
  })

  it("无 finish-step 收尾时也能正常返回（流自然结束）", async () => {
    // 调用方（ToolRuntime）有责任处理"流结束但未 emit finish"的兜底——
    // adapter 本身只做映射，不强制注入 finish。
    const events = await collectAdapterEvents(OpenAICompatibleProtocol, [
      { type: "text-delta", text: "incomplete" } as unknown as Part,
    ])
    expect(events).toEqual([{ type: "text-delta", text: "incomplete" }])
  })
})
