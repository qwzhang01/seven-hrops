/**
 * Provider 协议适配层 — 共享 helper（`protocols/_shared.ts`）
 *
 * 本文件汇集**所有 ProtocolAdapter 共用**的 stream/message/tool/schema 转换逻辑，
 * 让阶段 3.2 / 3.3 / 3.4 / 3.5 的四个 adapter 文件保持薄壳（< 80 行各一），
 * 避免在多个 adapter 间复制粘贴 raw stream → LLMStreamEvent 的核心 switch case。
 *
 * 设计来源：
 * - 阶段 3.1 任务：搬现有 [`provider/index.ts`](../index.ts) 的 `aiSdkStreamToEffect` /
 *   `convertToAiSdkMessages` / `convertToAiSdkToolsForDeclarationOnly` /
 *   `convertJsonSchemaToZod` 四件套，**不改语义**，只重排到协议层。
 * - 把 `aiSdkStreamToEffect` 进一步拆为 `mapTextStreamPart`（纯 pure 单事件映射）
 *   + `streamFromTextStreamParts`（流装配），让 prompt-style-tool-call 装饰器
 *   能复用同一份事件映射规则而不必拷贝。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * - `convertToAiSdkToolsForDeclarationOnly` SHALL NOT 给 SDK 传 `execute`；
 *   工具执行由 ToolRuntime 独占。
 * - 调用 `streamText` 的位置 SHALL 显式 `stopWhen: stepCountIs(1)`。
 * - 本文件的所有函数 SHALL 仅做 stream/数据形态转换，不持有 ToolRuntime
 *   / Session / Provider 的引用。
 */

import { Stream } from "effect"
import {
  type ModelMessage as AiModelMessage,
  type TextStreamPart,
  type Tool as AiTool,
} from "ai"
import { z } from "zod"
import type {
  ContentPart,
  LLMStreamEvent,
  ModelMessage,
  ToolDefinition,
} from "../../agent/tool-runtime"

// ─── AI SDK Stream → LLMStreamEvent ──────────────────────────────────

/**
 * 把单个 AI SDK `TextStreamPart` 映射为 0 或 1 个 `LLMStreamEvent`。
 *
 * 这是协议层最核心的纯函数：
 * - 返回 `null` 表示该 part 与上层无关（例如 `step-start` / `start` / `text-end`），
 *   流装配阶段会过滤掉。
 * - 不消费多 part（无状态），跨 part 累积逻辑由调用方（如 prompt-style 装饰器
 *   的状态机）负责。
 *
 * 行为映射表（与现行 [`provider/index.ts`](../index.ts) `aiSdkStreamToEffect` 等价）：
 *
 * | TextStreamPart.type | LLMStreamEvent.type        | 备注                                  |
 * |---------------------|----------------------------|---------------------------------------|
 * | `text-delta`        | `text-delta`               | 直传 `text` 字段                      |
 * | `reasoning-delta`   | `reasoning-delta`          | OpenAI 协议特有；其他协议不会出现    |
 * | `tool-call`         | `tool-call`                | `id` 缺失时回退 `tc-${Date.now()}`    |
 * | `tool-result`       | `tool-result`              | 兼容 `output` / `result` 字段命名     |
 * | `finish-step`       | `finish` (`reason=stop/…`) | single-step 等价于本轮流结束          |
 * | `error`             | `error`                    | 直传 `error`（unknown）                |
 * | `abort`             | `finish` (`reason=abort`)  | 用户取消视为正常 finish               |
 * | 其他                | `null`                     | 跳过                                  |
 */
export function mapTextStreamPart(
  part: TextStreamPart<Record<string, never>>,
): LLMStreamEvent | null {
  switch (part.type) {
    case "text-delta":
      return { type: "text-delta", text: part.text }
    case "reasoning-delta":
      return { type: "reasoning-delta", text: part.text }
    case "tool-call":
      return {
        type: "tool-call",
        id: part.toolCallId ?? `tc-${Date.now()}`,
        name: part.toolName,
        input: part.input as Record<string, unknown>,
      }
    case "tool-result":
      return {
        type: "tool-result",
        id: part.toolCallId,
        name: part.toolName,
        result:
          ("output" in part
            ? (part as { output: unknown }).output
            : undefined) ??
          ("result" in part
            ? (part as { result: unknown }).result
            : undefined),
      }
    case "finish-step":
      // Provider 是单步的（stopWhen: stepCountIs(1)），多步循环由 ToolRuntime 持有。
      // single-step 语义下 `finish-step` 等价于本轮流结束。详见 arch-runtime-single-loop。
      return { type: "finish", reason: part.finishReason ?? "stop" }
    case "error":
      return {
        type: "error",
        error: part.error ?? new Error("Unknown stream error"),
      }
    case "abort":
      return { type: "finish", reason: "abort" }
    default:
      return null
  }
}

/**
 * 把 AI SDK 的 raw `TextStreamPart` async iterable 装配为 Effect `Stream<LLMStreamEvent, Error>`。
 *
 * 三个具名 adapter（openai-native / openai-compatible / anthropic-messages）
 * 在各自的协议形态归一化成 `TextStreamPart` 之后都最终经此装配上链。
 *
 * 错误处理：iterable 抛任意值时统一封装为 `Error` 实例，避免上层接到 unknown
 * error 类型。
 */
export function streamFromTextStreamParts(
  aiStream: AsyncIterable<TextStreamPart<Record<string, never>>>,
): Stream.Stream<LLMStreamEvent, Error> {
  return Stream.fromAsyncIterable(aiStream, (err) =>
    err instanceof Error ? err : new Error(String(err)),
  ).pipe(
    Stream.map((part) => mapTextStreamPart(part)),
    Stream.filter((event): event is LLMStreamEvent => event !== null),
  )
}

// ─── Tool Input Delta 累积（prompt-style 装饰器复用） ────────────────

/**
 * 跨 chunk 累积 `tool-input-delta` 文本片段并 JSON 解析的轻量缓冲。
 *
 * AI SDK 的官方协议 tool 调用走 `tool-call` 单事件直接给出完整 `input`，无需
 * 累积。本 helper 主要给阶段 3.5 的 prompt-style 装饰器使用——豆包/Qwen 等
 * 模型把工具 JSON 编码进文本流，token 跨 chunk 是常态。
 *
 * 设计要点：
 * - `MAX_BUFFER_BYTES = 1 MiB`：防止异常长流耗尽内存（单工具 JSON 极少超 1 MiB）。
 * - JSON parse 失败时返回 `null` + 保留 buffer，由调用方决定是 emit error 还是
 *   降级为 text-delta。
 */
export const MAX_TOOL_INPUT_BUFFER_BYTES = 1 * 1024 * 1024

export interface ToolInputAccumulator {
  /** 追加一段文本到缓冲；返回新缓冲长度。超过 MAX_TOOL_INPUT_BUFFER_BYTES 时抛错。 */
  readonly append: (chunk: string) => number
  /** 尝试把当前缓冲解析为 JSON 对象；成功返回对象 + 清空缓冲；失败返回 null。 */
  readonly tryFlushAsJson: () => Record<string, unknown> | null
  /** 清空缓冲（用于流提前结束时清场）。 */
  readonly reset: () => void
  /** 当前缓冲文本（只读，用于错误日志）。 */
  readonly peek: () => string
}

export function createToolInputAccumulator(): ToolInputAccumulator {
  let buffer = ""

  const append = (chunk: string): number => {
    if (buffer.length + chunk.length > MAX_TOOL_INPUT_BUFFER_BYTES) {
      throw new Error(
        `[protocol-adapter] tool-input buffer exceeded ${MAX_TOOL_INPUT_BUFFER_BYTES} bytes; aborting`,
      )
    }
    buffer += chunk
    return buffer.length
  }

  const tryFlushAsJson = (): Record<string, unknown> | null => {
    if (buffer.length === 0) return null
    try {
      const parsed = JSON.parse(buffer) as unknown
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null
      }
      buffer = ""
      return parsed as Record<string, unknown>
    } catch {
      return null
    }
  }

  const reset = (): void => {
    buffer = ""
  }

  const peek = (): string => buffer

  return { append, tryFlushAsJson, reset, peek }
}

// ─── prompt-style 消息扁平化（follow-up 消息预处理） ─────────────────

/**
 * 把包含 tool-call / tool-result ContentPart 的消息历史扁平化为纯文本消息。
 *
 * ## 背景
 *
 * prompt-style 模型（豆包 / Qwen）不支持原生 function-calling 的消息 schema
 * （即 AI SDK 的 `role: "assistant" + content: [{type: "tool-call"}]` 和
 * `role: "tool" + content: [{type: "tool-result"}]`）。当 ToolRuntime 执行完
 * 工具后构造 follow-up 消息再次发给 LLM 时，如果直接用标准格式，AI SDK 的
 * `streamText` 会在校验 messages 时报 `AI_InvalidPromptError`。
 *
 * 本函数在 `convertToAiSdkMessages` 之前调用，把 tool-call / tool-result
 * 消息转换为模型能理解的纯文本格式：
 *
 * - assistant 消息中的 `tool-call` ContentPart → 编码为文本描述
 * - `role: "tool"` 消息中的 `tool-result` ContentPart → 转为 `role: "user"` 纯文本消息
 *
 * ## 架构合规性
 *
 * 本函数仅做数据形态转换（ModelMessage[] → ModelMessage[]），不持有任何
 * ToolRuntime / Session / Provider 引用，符合纪律 3.2（ProtocolAdapter 仅做
 * 流归一化）的精神——虽然本函数不在 ProtocolAdapter 内部，但它服务于同一目的。
 *
 * @param messages 内部 ModelMessage 数组（可能包含 tool-call / tool-result ContentPart）
 * @returns 扁平化后的 ModelMessage 数组（所有消息都是纯文本，可安全传给不支持 function-calling 的模型）
 */
export function flattenToolMessagesForPromptStyle(
  messages: ReadonlyArray<ModelMessage>,
): ModelMessage[] {
  const result: ModelMessage[] = []

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      result.push(msg)
      continue
    }

    const parts = msg.content as ReadonlyArray<ContentPart>

    if (msg.role === "tool") {
      // role: "tool" 消息 → 转为 role: "user" 纯文本，包含工具执行结果
      const textLines: string[] = []
      for (const part of parts) {
        if (part.type === "tool-result") {
          const resultStr = typeof part.result === "string"
            ? part.result
            : JSON.stringify(part.result, null, 2)
          if (part.error) {
            textLines.push(`[Tool "${part.name}" error]: ${part.error}`)
          } else {
            textLines.push(`[Tool "${part.name}" result]:\n${resultStr}`)
          }
        }
      }
      if (textLines.length > 0) {
        result.push({ role: "user", content: textLines.join("\n\n") })
      }
      continue
    }

    if (msg.role === "assistant") {
      // assistant 消息中可能混合 text + tool-call ContentPart
      const textParts: string[] = []
      const toolCallTexts: string[] = []

      for (const part of parts) {
        if (part.type === "text") {
          textParts.push(part.text)
        } else if (part.type === "tool-call") {
          // 把 tool-call 编码为文本描述，让模型知道它之前调用了什么工具
          const argsStr = JSON.stringify(part.input)
          toolCallTexts.push(`[Calling tool "${part.name}" with args: ${argsStr}]`)
        }
      }

      const allText = [...textParts, ...toolCallTexts].join("\n")
      if (allText.length > 0) {
        result.push({ role: "assistant", content: allText })
      }
      continue
    }

    // 其他角色（user / system）直接保留
    result.push(msg)
  }

  return result
}

// ─── ModelMessage 转换（内部 → AI SDK） ──────────────────────────────

/**
 * Cast 到 Vercel AI SDK ModelMessage 类型。
 *
 * 内部 `ModelMessage.content` 是简化的 `ContentPart[]` 表达，与 AI SDK v6
 * 的 discriminated union 形态结构等价但类型签名不完全匹配。运行时值兼容，
 * 此处用 double-cast 桥接结构差异。
 */
function asAiMessage<T>(msg: T): AiModelMessage {
  return msg as unknown as AiModelMessage
}

/**
 * 把内部 `ModelMessage[]` 转换为 AI SDK 的 `ModelMessage[]`。
 *
 * 与现行 [`provider/index.ts`](../index.ts) 的 `convertToAiSdkMessages` 行为等价。
 * 关键规则：
 * - assistant 消息含 tool-call 时，把 text 与 tool-call 拼成 `content` 数组；
 * - role === "tool" 的消息整条转为 tool-result 数组；
 * - 其他纯文本消息直接 stringify。
 */
export function convertToAiSdkMessages(
  messages: ReadonlyArray<ModelMessage>,
): AiModelMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return asAiMessage({ role: msg.role, content: msg.content })
    }

    const parts = msg.content as ReadonlyArray<ContentPart>
    const textParts: string[] = []
    const toolCallParts: {
      type: "tool-call"
      toolCallId: string
      toolName: string
      input: unknown
    }[] = []
    const toolResultParts: {
      type: "tool-result"
      toolCallId: string
      toolName: string
      output: unknown
      isError?: boolean
    }[] = []

    for (const part of parts) {
      if (part.type === "text") {
        textParts.push(part.text)
      } else if (part.type === "tool-call") {
        toolCallParts.push({
          type: "tool-call",
          toolCallId: part.id,
          toolName: part.name,
          input: part.input,
        })
      } else if (part.type === "tool-result") {
        toolResultParts.push({
          type: "tool-result",
          toolCallId: part.id,
          toolName: part.name,
          output: part.result,
          isError: !!part.error,
        })
      }
    }

    if (msg.role === "tool") {
      return asAiMessage({ role: "tool", content: toolResultParts })
    }

    if (toolCallParts.length > 0) {
      return asAiMessage({
        role: "assistant",
        content: [
          ...(textParts.length > 0
            ? [{ type: "text" as const, text: textParts.join("\n") }]
            : []),
          ...toolCallParts,
        ],
      })
    }

    return asAiMessage({ role: msg.role, content: textParts.join("\n") })
  })
}

// ─── Tool 转换（declaration-only，single-loop 契约） ─────────────────

/**
 * 把 `ToolDefinition[]` 转换为 AI SDK 的 declaration-only tool 注册表。
 *
 * INVARIANT (arch-runtime-single-loop):
 *   AI SDK SHALL NOT 执行工具——工具调度由 [`ToolRuntime.dispatch`](../../agent/tool-runtime.ts)
 *   独占。本函数仅传 `description` + `inputSchema`，刻意不传 `execute`，
 *   让 SDK 仅产出 raw `tool-call` 事件由 ToolRuntime 接管 dispatch 与
 *   follow-up 拼接。
 *
 *   本函数 + 调用 `streamText` 时显式 `stopWhen: stepCountIs(1)` 共同把
 *   `streamText` 钳成单步 raw LLM stream，恰好契合 ToolRuntime 的循环预期。
 *
 *   遗漏 `execute` 但忘记 `stopWhen` → SDK 永久挂起等 tool-result，UI 卡死。
 *   反之传了 `execute` → 同一工具被 SDK + ToolRuntime 双重调度。
 */
export function convertToAiSdkToolsForDeclarationOnly(
  tools: ReadonlyArray<ToolDefinition>,
): Record<string, AiTool> {
  const result: Record<string, AiTool> = {}
  for (const tool of tools) {
    result[tool.name] = {
      description: tool.description,
      inputSchema: convertJsonSchemaToZod(tool.parameters),
      // NO `execute` here. See INVARIANT above.
    } satisfies AiTool
  }
  return result
}

// ─── JSON Schema → Zod ───────────────────────────────────────────────

/**
 * 把工具 `parameters` 字段（JSON Schema 形）转换为 Zod schema。
 *
 * 与现行 [`provider/index.ts`](../index.ts) 的 `convertJsonSchemaToZod` 行为等价。
 * 当前实现仅处理顶层 `type: "object"` 的常见情形；嵌套 schema、`oneOf` /
 * `anyOf` / `$ref` 等高级特性目前回退为 `z.unknown()`，待真实工具需要时再扩展。
 */
export function convertJsonSchemaToZod(
  schema: Record<string, unknown>,
): z.ZodType {
  const { type, properties, required } = schema as {
    type?: string
    properties?: Record<string, Record<string, unknown>>
    required?: string[]
  }

  if (!properties || !type || type !== "object") {
    return z.object({}).passthrough()
  }

  const shape: Record<string, z.ZodType> = {}
  for (const [key, prop] of Object.entries(properties)) {
    shape[key] = zodTypeFromProp(prop)
  }

  if (!required || required.length === 0) {
    return z.object(
      Object.fromEntries(
        Object.entries(shape).map(([k, v]) => [k, v.optional()]),
      ),
    )
  }

  return z.object(shape)
}

function zodTypeFromProp(prop: Record<string, unknown>): z.ZodType {
  const type = prop.type as string | undefined

  switch (type) {
    case "string":
      return z.string()
    case "number":
    case "integer":
      return z.number()
    case "boolean":
      return z.boolean()
    case "array":
      return z.array(z.unknown())
    case "object":
      return z.record(z.unknown())
    default:
      return z.unknown()
  }
}
