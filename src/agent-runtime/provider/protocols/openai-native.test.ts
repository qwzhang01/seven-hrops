/**
 * `protocols/openai-native.test.ts`
 *
 * **任务 7.1**：openai-native ProtocolAdapter 的契约测试。
 *
 * 覆盖 spec.md `Scenario: 协议适配器把 raw stream 归一化为 LLMStreamEvent`
 * 在 OpenAI 官方协议家族下的所有事件类型转换：
 *
 * | 输入 TextStreamPart.type | 期望输出 LLMStreamEvent.type | 备注                            |
 * |--------------------------|------------------------------|---------------------------------|
 * | `text-delta`             | `text-delta`                 | 直传 text 字段                   |
 * | `reasoning-delta`        | `reasoning-delta`            | OpenAI 官方协议特有             |
 * | `tool-call`              | `tool-call`                  | id/name/input 透传              |
 * | `tool-result`            | `tool-result`                | 兼容 output / result 字段       |
 * | `finish-step` (stop)     | `finish` (reason="stop")     | single-step 等价于本轮流结束     |
 * | `error`                  | `error`                      | 透传 error                      |
 * | `abort`                  | `finish` (reason="abort")    | 用户取消视为正常 finish          |
 * | 未识别 part              | (skip)                       | 不出现在输出流                  |
 *
 * ## 单一 agent loop 不变量
 *
 * 测试中**绝不**构造 ToolRuntime / Session / 真实 streamText；仅验证
 * adapter 的纯函数转换。adapter 不能在测试期间产生工具 dispatch 副作用——
 * 这条由 8.x / single-loop.test.ts 守卫；本文件聚焦事件映射正确性。
 */

import { describe, it, expect } from "vitest"
import type { TextStreamPart } from "ai"
import { OpenAINativeProtocol } from "./openai-native"
import { collectAdapterEvents } from "./_protocol-test-utils"

// 用 any 绕过 AI SDK 复杂泛型；测试场景下我们只关心 part.type 与字段是否被 adapter 正确读取。
// 单测里宽松 cast 是合理 trade-off——type-level 严谨性由 vite tsc 在生产代码处保证。
type Part = TextStreamPart<Record<string, never>>

describe("OpenAINativeProtocol", () => {
  it("protocolID === 'openai-native'", () => {
    expect(OpenAINativeProtocol.protocolID).toBe("openai-native")
  })

  it("text-delta → LLMStreamEvent.text-delta（直传 text）", async () => {
    const events = await collectAdapterEvents(OpenAINativeProtocol, [
      { type: "text-delta", text: "hello" } as unknown as Part,
      { type: "text-delta", text: " world" } as unknown as Part,
    ])
    expect(events).toEqual([
      { type: "text-delta", text: "hello" },
      { type: "text-delta", text: " world" },
    ])
  })

  it("reasoning-delta → LLMStreamEvent.reasoning-delta（OpenAI 官方协议特有）", async () => {
    const events = await collectAdapterEvents(OpenAINativeProtocol, [
      { type: "reasoning-delta", text: "思考中..." } as unknown as Part,
    ])
    expect(events).toEqual([
      { type: "reasoning-delta", text: "思考中..." },
    ])
  })

  it("tool-call → LLMStreamEvent.tool-call（id/name/input 透传）", async () => {
    const events = await collectAdapterEvents(OpenAINativeProtocol, [
      {
        type: "tool-call",
        toolCallId: "call_123",
        toolName: "get_weather",
        input: { city: "Beijing" },
      } as unknown as Part,
    ])
    expect(events).toEqual([
      {
        type: "tool-call",
        id: "call_123",
        name: "get_weather",
        input: { city: "Beijing" },
      },
    ])
  })

  it("tool-call 缺 toolCallId 时回退到 tc-${Date.now()} 前缀", async () => {
    const events = await collectAdapterEvents(OpenAINativeProtocol, [
      {
        type: "tool-call",
        // toolCallId 缺失（部分 SDK 早期版本会 emit 不含 id 的 tool-call）
        toolName: "echo",
        input: { msg: "hi" },
      } as unknown as Part,
    ])
    expect(events).toHaveLength(1)
    const evt = events[0]
    if (evt.type !== "tool-call") throw new Error("expected tool-call event")
    expect(evt.id).toMatch(/^tc-\d+/)
    expect(evt.name).toBe("echo")
    expect(evt.input).toEqual({ msg: "hi" })
  })

  it("tool-result：兼容 output / result 两种字段命名", async () => {
    const events = await collectAdapterEvents(OpenAINativeProtocol, [
      // 新版 SDK：output 字段
      {
        type: "tool-result",
        toolCallId: "c1",
        toolName: "echo",
        output: { ok: true },
      } as unknown as Part,
      // 旧版 SDK：result 字段
      {
        type: "tool-result",
        toolCallId: "c2",
        toolName: "echo",
        result: { ok: false },
      } as unknown as Part,
    ])
    expect(events).toEqual([
      { type: "tool-result", id: "c1", name: "echo", result: { ok: true } },
      { type: "tool-result", id: "c2", name: "echo", result: { ok: false } },
    ])
  })

  it("finish-step → LLMStreamEvent.finish（reason 透传）", async () => {
    const events = await collectAdapterEvents(OpenAINativeProtocol, [
      { type: "finish-step", finishReason: "stop" } as unknown as Part,
    ])
    expect(events).toEqual([{ type: "finish", reason: "stop" }])
  })

  it("finish-step 缺 finishReason 时降级为 'stop'", async () => {
    const events = await collectAdapterEvents(OpenAINativeProtocol, [
      { type: "finish-step" } as unknown as Part,
    ])
    expect(events).toEqual([{ type: "finish", reason: "stop" }])
  })

  it("error part → LLMStreamEvent.error", async () => {
    const errPart = { type: "error", error: new Error("boom") } as unknown as Part
    const events = await collectAdapterEvents(OpenAINativeProtocol, [errPart])
    expect(events).toHaveLength(1)
    const evt = events[0]
    if (evt.type !== "error") throw new Error("expected error event")
    expect((evt.error as Error).message).toBe("boom")
  })

  it("abort → LLMStreamEvent.finish (reason='abort')", async () => {
    // 用户取消按 spec 视为正常 finish 而非 error
    const events = await collectAdapterEvents(OpenAINativeProtocol, [
      { type: "abort" } as unknown as Part,
    ])
    expect(events).toEqual([{ type: "finish", reason: "abort" }])
  })

  it("未识别的 part type 被跳过（不污染输出流）", async () => {
    const events = await collectAdapterEvents(OpenAINativeProtocol, [
      { type: "step-start" } as unknown as Part,
      { type: "text-delta", text: "ok" } as unknown as Part,
      { type: "text-end" } as unknown as Part,
      { type: "finish-step", finishReason: "stop" } as unknown as Part,
    ])
    // step-start / text-end 应被过滤
    expect(events).toEqual([
      { type: "text-delta", text: "ok" },
      { type: "finish", reason: "stop" },
    ])
  })

  it("混合事件序列保持时序（按输入顺序 emit）", async () => {
    const events = await collectAdapterEvents(OpenAINativeProtocol, [
      { type: "reasoning-delta", text: "let me think" } as unknown as Part,
      { type: "text-delta", text: "answer: " } as unknown as Part,
      {
        type: "tool-call",
        toolCallId: "t1",
        toolName: "fn",
        input: { x: 1 },
      } as unknown as Part,
      { type: "text-delta", text: "done" } as unknown as Part,
      { type: "finish-step", finishReason: "stop" } as unknown as Part,
    ])
    expect(events).toEqual([
      { type: "reasoning-delta", text: "let me think" },
      { type: "text-delta", text: "answer: " },
      { type: "tool-call", id: "t1", name: "fn", input: { x: 1 } },
      { type: "text-delta", text: "done" },
      { type: "finish", reason: "stop" },
    ])
  })
})
