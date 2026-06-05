/**
 * Provider 协议适配层 — `protocols/prompt-style-tool-call.ts`
 *
 * **prompt-style tool-call 装饰器**——把"工具调用编码进文本流"的非标准
 * 协议（豆包 / Qwen 等）整流为标准 `LLMStreamEvent.tool-call`。
 *
 * ## 模型背景
 *
 * 部分 OpenAI-Compatible 厂商（火山方舟豆包、阿里 Qwen 部分模型卡）不走
 * 原生 function-calling，而是在 text 流里嵌入伪 token 编码工具调用：
 *
 * - **豆包**（火山方舟）：`<|FunctionCallBegin|>[{"name":"X","parameters":{...}}, ...]<|FunctionCallEnd|>`
 *   官方文档：https://www.volcengine.com/docs/82379/1330310（豆包 1.5 模型卡）
 *   真机锚点：参 [`__fixtures__/doubao-real.ts`](../__fixtures__/doubao-real.ts)
 * - **Qwen**（通义千问）：`<tool_call>{"name":"X","arguments":{...}}</tool_call>`
 *   官方文档：https://qwen.readthedocs.io/en/latest/framework/function_call.html
 *
 * AI SDK 不识别这些伪 token——它们到 SDK 层面就是普通 text-delta 字节。
 * 本装饰器在 ProtocolAdapter 层之上做"text-delta 流再扫描"，把 token 序列
 * 整流为合成的 `LLMStreamEvent.tool-call`。
 *
 * ## JSON 体形态兼容
 *
 * begin/end token 之间的 JSON 体在不同模型卡形态有偏差，本装饰器同时兼容：
 *
 * - **顶层数组**（豆包真机）：`[{...}, {...}]`——一段允许多并发 tool-call，
 *   逐项解析后 emit 多条 `LLMStreamEvent.tool-call`；数组中混入非 object 项时
 *   该项 emit `error`、其它项继续解析（不 short-circuit）。
 * - **顶层对象**（自造 fixture / Qwen 文档示例）：`{...}`——按单条解析。
 * - **入参字段名**：`arguments | parameters` 二选一——`arguments` 优先（与
 *   Qwen 文档与早期自造 fixture 对齐），缺失时回落到 `parameters`（豆包真机），
 *   二者均缺或非 object 时降级 `{}`。
 *
 * **真机 fixture 锚点纪律**（来源：[`runtime-multimodel-real-machine-verification`](../../../../openspec/changes/runtime-multimodel-real-machine-verification/specs/platform-foundation/spec.md)）：
 * 任何 prompt-style 风格的引入或修改 SHALL 在 `integration-<provider>.test.ts`
 * 至少包含一条来自真机抓包/官方文档逐字节复刻的「真机锚点 case」。
 *
 * ## 装饰器形态（不侵入 inner adapter）
 *
 * 装饰器接收 inner adapter 已经产出的 `LLMStreamEvent` 流，对 `text-delta`
 * 事件做状态机再处理；其它事件（reasoning-delta / tool-call / tool-result /
 * finish / error）原样透传。这样符合 spec.md 的两条约束：
 *
 * - "装饰器型 ProtocolAdapter 仅允许做 stream-in/stream-out"
 * - "原始 text-delta 中属于 token 序列的字节 SHALL 被吞掉"
 *
 * ## 跨 chunk 边界处理
 *
 * SDK 把 raw stream 切成任意多 chunk（最坏 1 字节 1 chunk）。状态机维护一个
 * `buffer`，长度 < `MAX_TOKEN_LEN` 时 SHALL NOT flush，防止跨 chunk token 漏检。
 *
 * `MAX_TOKEN_LEN = 64` 来自 spec.md MVP 取值；`TOKEN_PATTERNS` 中所有 begin/end
 * token 长度均远低于此（`<|FunctionCallBegin|>` 21 字节、`</tool_call>` 12 字节）。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop / platform-foundation 纪律 3.2）
 *
 * - 装饰器**不**调用任何工具的 `execute`、**不**拼 follow-up、**不**多步循环。
 * - 仅 emit 合成的 `LLMStreamEvent.tool-call` 让 ToolRuntime 接管 dispatch。
 * - 由 [`prompt-style-tool-call.test.ts`](./prompt-style-tool-call.test.ts) Case E 守卫。
 */

import { Stream } from "effect"
import type { LLMStreamEvent } from "../../agent/tool-runtime"
import type { ProtocolAdapter, PromptStyleID } from "../_types"

// ─── Token 模式表（任务 3.6） ────────────────────────────────────────

/**
 * prompt-style 模型的 token 编码常量表。
 *
 * 新增风格时：① _types.ts 的 PromptStyleID 联合追加；② 本表追加 entry；
 * ③ prompt-style-tool-call.test.ts 追加 case A–E；④ 在文件头注释贴模型卡链接。
 */
export const TOKEN_PATTERNS: Readonly<
  Record<PromptStyleID, { readonly begin: string; readonly end: string }>
> = Object.freeze({
  doubao: {
    // https://www.volcengine.com/docs/82379/1330310 — 豆包 1.5 系列工具调用编码
    begin: "<|FunctionCallBegin|>",
    end: "<|FunctionCallEnd|>",
  },
  qwen: {
    // https://qwen.readthedocs.io/en/latest/framework/function_call.html
    begin: "<tool_call>",
    end: "</tool_call>",
  },
})

/** spec.md MVP 取值；buffer 长度 < 此阈值时 SHALL NOT flush，防止跨 chunk 漏检。 */
export const MAX_TOKEN_LEN = 64

// ─── 状态机 ──────────────────────────────────────────────────────────

type State =
  | { readonly mode: "idle"; readonly buffer: string }
  | { readonly mode: "in-call"; readonly buffer: string }

/**
 * 单次 step 的 emit 结果。
 *
 * - `events`：本次喂入文本/finish/error 后应该 emit 的 `LLMStreamEvent` 列表（0+）。
 * - `next`：状态机的下一态。
 */
interface StepResult {
  readonly events: ReadonlyArray<LLMStreamEvent>
  readonly next: State
}

/**
 * 处理一段文本输入（来自 inner adapter 的 text-delta event）。
 *
 * 行为：
 * - `idle` 态：扫描 `begin` token；命中则把 token 之前的部分作为 text-delta emit；
 *   切到 `in-call`。未命中但 buffer 长度 ≥ `MAX_TOKEN_LEN` 时把"前面没命中可能"
 *   的部分（buffer.length - MAX_TOKEN_LEN 之前那段）作为 text-delta emit。
 * - `in-call` 态：扫描 `end` token；命中则尝试 JSON 解析中间内容，
 *   解析成功 emit `tool-call`，失败 emit `error`；切回 `idle`。
 */
function stepText(
  state: State,
  chunk: string,
  pattern: { begin: string; end: string },
): StepResult {
  let buffer = state.buffer + chunk
  let mode = state.mode
  const events: LLMStreamEvent[] = []

  // 多 token 序列可能在同一 chunk 内连续出现（如 token-A 紧跟 token-B）；用 while 处理。
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (mode === "idle") {
      const beginIdx = buffer.indexOf(pattern.begin)
      if (beginIdx >= 0) {
        // 命中 begin：把 token 之前的部分作为 text emit，剩余进入 in-call buffer。
        const before = buffer.slice(0, beginIdx)
        if (before.length > 0) {
          events.push({ type: "text-delta", text: before })
        }
        buffer = buffer.slice(beginIdx + pattern.begin.length)
        mode = "in-call"
        continue // 继续在新 buffer 里扫 end
      }

      // 未命中 begin：safe-flush 那部分一定不会再参与 begin 匹配的字节。
      // 保留尾部 `MAX_TOKEN_LEN - 1` 字节作为"可能的跨 chunk token 前缀"。
      const safeLen = buffer.length - (MAX_TOKEN_LEN - 1)
      if (safeLen > 0) {
        events.push({ type: "text-delta", text: buffer.slice(0, safeLen) })
        buffer = buffer.slice(safeLen)
      }
      break
    }

    // mode === "in-call"
    const endIdx = buffer.indexOf(pattern.end)
    if (endIdx >= 0) {
      const callJson = buffer.slice(0, endIdx)
      buffer = buffer.slice(endIdx + pattern.end.length)
      // 一段 begin/end 之间允许多 tool-call（豆包真机数组形态），逐项 emit。
      events.push(...parseToolCalls(callJson))
      mode = "idle"
      continue
    }

    // in-call 但还没看到 end token：继续累积，绝不 flush（属于工具入参 JSON 不能漏字节）。
    break
  }

  return { events, next: { mode, buffer } as State }
}

/**
 * 把 buffer 中的 callJson 解析为 0+ 条 `LLMStreamEvent`：
 *
 * - 顶层 JSON 是数组（豆包真机）：每个数组元素独立解析，聚合返回多个事件；
 *   数组元素非对象时 emit 一条 `error`（不影响其它元素）。
 * - 顶层 JSON 是对象（自造 fixture / Qwen 示例）：返回长度 1 的事件数组。
 * - JSON.parse 失败：返回长度 1 的 `error` 事件。
 *
 * 入参字段读取顺序：`arguments` 优先 → `parameters` 回落 → 都缺或非 object 时降级 `{}`。
 */
function parseToolCalls(callJson: string): ReadonlyArray<LLMStreamEvent> {
  let parsed: unknown
  try {
    parsed = JSON.parse(callJson)
  } catch (err) {
    return [
      {
        type: "error",
        error: new Error(
          `[prompt-style] tool-call JSON parse failed: ${(err as Error).message}; raw=${truncate(callJson, 200)}`,
        ),
      },
    ]
  }

  if (Array.isArray(parsed)) {
    // 顶层数组：每项独立解析（豆包真机形态：`[{...}, {...}]`）。
    return parsed.map((item, idx) => parseSingleToolCall(item, `array[${idx}]`, callJson))
  }
  return [parseSingleToolCall(parsed, "object", callJson)]
}

/**
 * 把单条 tool-call 候选（已 JSON.parse 后的 unknown）解析为一个 `LLMStreamEvent`。
 *
 * - 非 object（含 null / array）：emit `error`（位置上下文标在错误消息里）。
 * - 缺 string `name` 字段：emit `error`。
 * - 入参：`arguments ?? parameters`，非 object 时降级 `{}`。
 */
function parseSingleToolCall(
  candidate: unknown,
  positionHint: string,
  rawJson: string,
): LLMStreamEvent {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {
      type: "error",
      error: new Error(
        `[prompt-style] tool-call entry at ${positionHint} is not an object: ${truncate(rawJson, 200)}`,
      ),
    }
  }
  const obj = candidate as { name?: unknown; arguments?: unknown; parameters?: unknown }
  if (typeof obj.name !== "string") {
    return {
      type: "error",
      error: new Error(
        `[prompt-style] tool-call entry at ${positionHint} missing string field "name": ${truncate(rawJson, 200)}`,
      ),
    }
  }
  // arguments 优先（Qwen / 早期 fixture），parameters 回落（豆包真机）。
  // 用 ?? 让 null / undefined 都回落，与 design.md Decision 2 一致。
  const rawArgs = obj.arguments ?? obj.parameters
  const input =
    rawArgs !== undefined &&
    rawArgs !== null &&
    typeof rawArgs === "object" &&
    !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {}
  return {
    type: "tool-call",
    id: `ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: obj.name,
    input,
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…"
}

/**
 * 流终止（finish / error）时清场：
 * - `idle` 态有残余 buffer → 全部 flush 为 text-delta；
 * - `in-call` 态有残余 buffer → emit error（"prompt-style tool-call did not close"）。
 */
function finalize(state: State): ReadonlyArray<LLMStreamEvent> {
  const events: LLMStreamEvent[] = []
  if (state.mode === "idle") {
    if (state.buffer.length > 0) {
      events.push({ type: "text-delta", text: state.buffer })
    }
  } else {
    // in-call：未闭合 token，按 spec emit error
    events.push({
      type: "error",
      error: new Error(
        `[prompt-style] tool-call did not close before stream ended; partial buffer length=${state.buffer.length}`,
      ),
    })
  }
  return events
}

// ─── 装饰器 ──────────────────────────────────────────────────────────

/**
 * 用 prompt-style 装饰器包裹一个 inner ProtocolAdapter。
 *
 * 装饰后的 adapter `protocolID` 仍取 inner 的（因为底层协议族未变），但行为
 * 上 text-delta 流会先经 token 状态机扫描；所有非 text-delta 事件原样透传。
 *
 * @param inner 被包裹的基础 adapter（通常是 OpenAICompatibleProtocol）。
 * @param style 模型卡指定的 prompt-style ID（"doubao" / "qwen"）。
 */
export function withPromptStyleToolCall(
  inner: ProtocolAdapter,
  style: PromptStyleID,
): ProtocolAdapter {
  const pattern = TOKEN_PATTERNS[style]

  return {
    protocolID: inner.protocolID,
    transform: (rawStream) => {
      const innerStream = inner.transform(rawStream)
      // 用 mapAccum 维护状态机：每来一个 LLMStreamEvent，根据当前 state 算出
      // emit 列表与新 state；text-delta 喂状态机；finish/error 触发 finalize；
      // 其他事件原样透传。
      return innerStream.pipe(
        Stream.mapAccum(
          (): State => ({ mode: "idle", buffer: "" }),
          (state: State, event: LLMStreamEvent) => {
            if (event.type === "text-delta") {
              const { events, next } = stepText(state, event.text, pattern)
              return [next, events as readonly LLMStreamEvent[]] as const
            }
            if (event.type === "finish" || event.type === "error") {
              const flushed = finalize(state)
              // 流终止事件本身保留在末尾
              return [
                { mode: "idle", buffer: "" } as State,
                [...flushed, event] as readonly LLMStreamEvent[],
              ] as const
            }
            // 其他类型事件原样透传，不动 state
            return [state, [event] as readonly LLMStreamEvent[]] as const
          },
        ),
      )
    },
  }
}

// ─── 测试钩子 ────────────────────────────────────────────────────────

/**
 * 仅供 prompt-style-tool-call.test.ts 使用的内部钩子，暴露状态机纯函数
 * 让测试在不构造完整 Stream 的情况下断言"输入 chunk 序列 → 输出事件序列"。
 */
export const __internal = {
  stepText,
  finalize,
  parseToolCalls,
  parseSingleToolCall,
} as const
