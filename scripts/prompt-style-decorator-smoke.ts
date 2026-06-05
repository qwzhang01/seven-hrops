/**
 * prompt-style 装饰器 — 烟雾测试（阶段 3 验证脚本）
 *
 * 这不是 Vitest 正式测试套件（那是阶段 7.4–7.8 的事），仅用于在阶段 3 实现完成后
 * 立刻在真实 Effect Stream 上跑一遍 spec.md 的 4 个核心 scenario，
 * 提早发现状态机 bug，避免一直拖到阶段 7 写测试时才暴露。
 *
 * 不在 CI 内固定执行；登记在 [`MANUAL_COMMANDS.md`](../doc/MANUAL_COMMANDS.md)。
 *
 * 用 `pnpm exec tsx scripts/prompt-style-decorator-smoke.ts` 跑。
 */

import { Effect, Stream } from "effect"
import type { LLMStreamEvent } from "../src/agent-runtime/agent/tool-runtime"
import type { ProtocolAdapter } from "../src/agent-runtime/provider/_types"
import { withPromptStyleToolCall } from "../src/agent-runtime/provider/protocols/prompt-style-tool-call"

// ─── helpers ─────────────────────────────────────────────────────────

/** 构造一个 inner adapter：把"输入是 string[] chunks"伪装成已 emit text-delta + finish。 */
function makeFakeInner(chunks: string[]): ProtocolAdapter {
  return {
    protocolID: "openai-compatible",
    transform: () =>
      Stream.fromIterable<LLMStreamEvent>([
        ...chunks.map((c) => ({ type: "text-delta", text: c }) as const),
        { type: "finish", reason: "stop" } as const,
      ]),
  }
}

/** 用同样方式构造但末尾 emit `error`/`finish=abort` 触发 finalize 的异常分支。 */
function makeFakeInnerWithAbort(chunks: string[]): ProtocolAdapter {
  return {
    protocolID: "openai-compatible",
    transform: () =>
      Stream.fromIterable<LLMStreamEvent>([
        ...chunks.map((c) => ({ type: "text-delta", text: c }) as const),
        { type: "finish", reason: "abort" } as const,
      ]),
  }
}

async function collect(adapter: ProtocolAdapter): Promise<LLMStreamEvent[]> {
  const empty = (async function* () {})()
  const stream = adapter.transform(
    empty as unknown as AsyncIterable<
      import("ai").TextStreamPart<Record<string, never>>
    >,
  )
  const result = await Effect.runPromise(Stream.runCollect(stream))
  return [...result]
}

function summarize(events: LLMStreamEvent[]): string {
  return events
    .map((e) => {
      if (e.type === "text-delta") return `text:"${e.text}"`
      if (e.type === "tool-call") return `tool-call:${e.name}(${JSON.stringify(e.input)})`
      if (e.type === "error")
        return `error:${(e.error as Error).message?.slice(0, 60)}`
      if (e.type === "finish") return `finish:${e.reason}`
      return e.type
    })
    .join(" → ")
}

// ─── cases ───────────────────────────────────────────────────────────

async function caseA_normalToolCall() {
  console.log("\n[Case A] 豆包正常 token 序列（一次性输入）")
  const inner = makeFakeInner([
    `Hi <|FunctionCallBegin|>{"name":"echo","arguments":{"x":1}}<|FunctionCallEnd|> done`,
  ])
  const decorated = withPromptStyleToolCall(inner, "doubao")
  const events = await collect(decorated)
  console.log("  结果:", summarize(events))
  console.log(
    "  期望: text:\"Hi \" → tool-call:echo({\"x\":1}) → text:\" done\" → finish:stop",
  )
}

async function caseB_oneByteOneChunk() {
  console.log("\n[Case B] 1 字节 1 chunk 切割（spec.md 跨 chunk 边界 scenario）")
  const fullText = `Hi <|FunctionCallBegin|>{"name":"echo","arguments":{}}<|FunctionCallEnd|> done`
  const inner = makeFakeInner([...fullText])
  const decorated = withPromptStyleToolCall(inner, "doubao")
  const events = await collect(decorated)
  console.log("  结果:", summarize(events))
  console.log(
    "  期望: 合并后的 text:\"Hi \" → tool-call:echo({}) → text:\" done\" → finish:stop",
  )
}

async function caseC_unclosedToken() {
  console.log("\n[Case C] 流提前 abort 且 token 未闭合 → emit error")
  const inner = makeFakeInnerWithAbort([
    `<|FunctionCallBegin|>{"name":"slow"`,
  ])
  const decorated = withPromptStyleToolCall(inner, "doubao")
  const events = await collect(decorated)
  console.log("  结果:", summarize(events))
  console.log("  期望: error:\"prompt-style tool-call did not close...\" → finish:abort")
}

async function caseD_invalidJson() {
  console.log("\n[Case D] JSON 解析失败时降级为 error 不 crash")
  const inner = makeFakeInner([
    `<|FunctionCallBegin|>not-valid-json<|FunctionCallEnd|>`,
  ])
  const decorated = withPromptStyleToolCall(inner, "doubao")
  const events = await collect(decorated)
  console.log("  结果:", summarize(events))
  console.log("  期望: error:\"...JSON parse failed...\" → finish:stop")
}

async function caseE_qwen() {
  console.log("\n[Case E] Qwen 风格 <tool_call>...</tool_call>")
  const inner = makeFakeInner([
    `<tool_call>{"name":"search","arguments":{"q":"foo"}}</tool_call>`,
  ])
  const decorated = withPromptStyleToolCall(inner, "qwen")
  const events = await collect(decorated)
  console.log("  结果:", summarize(events))
  console.log(
    "  期望: tool-call:search({\"q\":\"foo\"}) → finish:stop",
  )
}

async function main() {
  console.log("=== prompt-style 装饰器烟雾测试 ===")
  await caseA_normalToolCall()
  await caseB_oneByteOneChunk()
  await caseC_unclosedToken()
  await caseD_invalidJson()
  await caseE_qwen()
  console.log("\n✅ 烟雾测试全部跑完。请人工对比每行的 结果 / 期望 是否一致。")
}

main().catch((e) => {
  console.error("FAIL:", e)
  process.exit(1)
})
