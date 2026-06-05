/**
 * Provider 协议适配层 — `protocols/openai-native.ts`
 *
 * **OpenAI 官方协议** adapter。处理 `@ai-sdk/openai` 工厂产出的 raw stream，
 * 把 reasoning-delta / text-delta / tool-call / finish-step / abort 五种事件
 * 类型归一化为 `LLMStreamEvent`。
 *
 * 注意：`reasoning-delta` 仅在 OpenAI 官方协议出现（`o1` / `o3` 系列模型卡的
 * 思考内容流），其他兼容厂商即便走同一 `@ai-sdk/openai-compatible` 包也不会
 * 产生这种 part。这是 openai-native 与 openai-compatible 在事件谱上的唯一
 * 实质差异——但映射规则统一在 [`_shared.ts`](./_shared.ts) `mapTextStreamPart`
 * 中已经覆盖，所以协议层薄壳即可。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * - 仅做 stream → stream 的纯函数式转换。
 * - 不持有 ToolRuntime / Session / Provider 引用。
 * - 不 dispatch 工具、不拼 follow-up、不多步循环。
 */

import type { ProtocolAdapter } from "../_types"
import { streamFromTextStreamParts } from "./_shared"

export const OpenAINativeProtocol: ProtocolAdapter = {
  protocolID: "openai-native",
  transform: (rawStream) => streamFromTextStreamParts(rawStream),
}
