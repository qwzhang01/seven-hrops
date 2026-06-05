/**
 * `protocols/anthropic-messages.test.ts`
 *
 * **任务 7.3**：anthropic-messages ProtocolAdapter 的契约测试。
 *
 * ## 设计澄清：测什么、不测什么
 *
 * Anthropic 的原始 SSE 协议事件谱（`content-block-start` /
 * `content-block-delta` / `content-block-stop` / `message-stop` /
 * `input_json_delta` 等）**在 `@ai-sdk/anthropic` 包内部**已经被归一化为
 * 通用的 `TextStreamPart`（与 openai-native / openai-compatible 等价的形态）。
 *
 * 因此 [`anthropic-messages.ts`](./anthropic-messages.ts) adapter 实际上只是
 * 走 `streamFromTextStreamParts` 装配——与另两个 adapter 在 stream 转换层
 * **完全同构**。
 *
 * 本测试**不**测试 raw SSE → TextStreamPart 的归一化（那是 SDK 的责任，超出
 * 协议层契约边界）。本测试聚焦：
 *
 * 1. `protocolID` 路由 key 正确；
 * 2. 拿到 SDK 已归一化的 `TextStreamPart` 后，转换出的 LLMStreamEvent 序列
 *    与 spec scenario 对齐；
 * 3. **三个 adapter 同构性 contract**：相同 `TextStreamPart` 输入下三者输出
 *    序列完全一致。这条契约保证未来任一 adapter 偏离 _shared 装配时立刻
 *    被这条测试拦截。
 *
 * tasks.md 7.3 提到的 `content-block-start` / `input_json_delta` /
 * `message-stop`——本测试以"SDK 已归一化为 TextStreamPart 后形态"对应：
 *
 * | 原 Anthropic 事件             | SDK 归一化后 TextStreamPart |
 * |-------------------------------|------------------------------|
 * | content-block-start (text)    | （隐含，无对应 part）         |
 * | content-block-delta (text)    | text-delta                   |
 * | content-block-stop (text)     | （隐含，无对应 part）         |
 * | content-block-start (tool_use)| （隐含，待 input_json 累积）  |
 * | input_json_delta              | （SDK 内部累积）              |
 * | content-block-stop (tool_use) | tool-call（带完整 input）     |
 * | message-stop + stop_reason    | finish-step                  |
 */

import { describe, it, expect } from "vitest"
import type { TextStreamPart } from "ai"
import { AnthropicMessagesProtocol } from "./anthropic-messages"
import { OpenAINativeProtocol } from "./openai-native"
import { OpenAICompatibleProtocol } from "./openai-compatible"
import { collectAdapterEvents } from "./_protocol-test-utils"

type Part = TextStreamPart<Record<string, never>>

describe("AnthropicMessagesProtocol", () => {
  it("protocolID === 'anthropic-messages'", () => {
    expect(AnthropicMessagesProtocol.protocolID).toBe("anthropic-messages")
  })

  it("content-block-delta(text) 序列 → text-delta 事件序列", async () => {
    // SDK 已把 Anthropic 的 content-block-start/delta/stop 归一化为单一的
    // text-delta part 序列；adapter 直接按相同规则透传。
    const events = await collectAdapterEvents(AnthropicMessagesProtocol, [
      { type: "text-delta", text: "Hello" } as unknown as Part,
      { type: "text-delta", text: ", " } as unknown as Part,
      { type: "text-delta", text: "Claude!" } as unknown as Part,
    ])
    expect(events).toEqual([
      { type: "text-delta", text: "Hello" },
      { type: "text-delta", text: ", " },
      { type: "text-delta", text: "Claude!" },
    ])
  })

  it("tool_use block 完整累积后 → 单条 tool-call 事件", async () => {
    // SDK 已把 content-block-start(tool_use) + 多次 input_json_delta +
    // content-block-stop(tool_use) 累积为一条 tool-call part。
    const events = await collectAdapterEvents(AnthropicMessagesProtocol, [
      { type: "text-delta", text: "Let me search..." } as unknown as Part,
      {
        type: "tool-call",
        toolCallId: "toolu_01ABC",
        toolName: "web_search",
        input: { query: "anthropic claude tools" },
      } as unknown as Part,
    ])
    expect(events).toEqual([
      { type: "text-delta", text: "Let me search..." },
      {
        type: "tool-call",
        id: "toolu_01ABC",
        name: "web_search",
        input: { query: "anthropic claude tools" },
      },
    ])
  })

  it("message-stop + stop_reason='end_turn' → finish (reason='end_turn')", async () => {
    // SDK 把 Anthropic 的 stop_reason（end_turn / tool_use / max_tokens 等）
    // 透传到 finish-step.finishReason；adapter 原样映射到 finish.reason。
    const events = await collectAdapterEvents(AnthropicMessagesProtocol, [
      { type: "text-delta", text: "Done." } as unknown as Part,
      { type: "finish-step", finishReason: "end_turn" } as unknown as Part,
    ])
    expect(events).toEqual([
      { type: "text-delta", text: "Done." },
      { type: "finish", reason: "end_turn" },
    ])
  })

  it("stop_reason='tool_use' → finish (reason='tool_use')", async () => {
    // tool_use 是 Anthropic 在工具调用回合结束时的特有 stop_reason；
    // adapter 不做特殊处理，由上层（ToolRuntime）按 reason 决定循环。
    const events = await collectAdapterEvents(AnthropicMessagesProtocol, [
      {
        type: "tool-call",
        toolCallId: "t1",
        toolName: "fn",
        input: {},
      } as unknown as Part,
      { type: "finish-step", finishReason: "tool_use" } as unknown as Part,
    ])
    expect(events[1]).toEqual({ type: "finish", reason: "tool_use" })
  })

  it("contract: 三个 adapter 在同构 TextStreamPart 输入下产出相同 LLMStreamEvent 序列", async () => {
    // 三 adapter 同构性 contract——若 anthropic-messages 偏离 _shared 装配
    // 引入额外转换规则，此测试 SHALL fail，让 reviewer 立刻看到偏差。
    const inputs: Part[] = [
      { type: "text-delta", text: "Sure" } as unknown as Part,
      {
        type: "tool-call",
        toolCallId: "u1",
        toolName: "calc",
        input: { x: 10 },
      } as unknown as Part,
      {
        type: "tool-result",
        toolCallId: "u1",
        toolName: "calc",
        output: 100,
      } as unknown as Part,
      { type: "finish-step", finishReason: "end_turn" } as unknown as Part,
    ]
    const anthropicEvents = await collectAdapterEvents(
      AnthropicMessagesProtocol,
      inputs,
    )
    const nativeEvents = await collectAdapterEvents(
      OpenAINativeProtocol,
      inputs,
    )
    const compatibleEvents = await collectAdapterEvents(
      OpenAICompatibleProtocol,
      inputs,
    )
    expect(anthropicEvents).toEqual(nativeEvents)
    expect(anthropicEvents).toEqual(compatibleEvents)
  })

  it("error part 正常透传", async () => {
    const events = await collectAdapterEvents(AnthropicMessagesProtocol, [
      { type: "error", error: new Error("anthropic 429") } as unknown as Part,
    ])
    expect(events).toHaveLength(1)
    const evt = events[0]
    if (evt.type !== "error") throw new Error("expected error event")
    expect((evt.error as Error).message).toBe("anthropic 429")
  })
})
