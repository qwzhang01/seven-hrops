/**
 * Provider 协议适配层 — `protocols/anthropic-messages.ts`
 *
 * **Anthropic Messages 协议** adapter。处理 `@ai-sdk/anthropic` 工厂产出的 raw stream。
 *
 * ## 关键设计：协议归一化由 `@ai-sdk/anthropic` 内部完成
 *
 * Anthropic 的原始 SSE 协议事件谱包含：
 * - `message_start` / `message_stop`
 * - `content_block_start` / `content_block_delta` / `content_block_stop`
 *   - text_delta（文本块）
 *   - input_json_delta（tool_use block 的工具入参 JSON 流）
 * - `ping` / `error`
 *
 * 这些底层事件**在 `@ai-sdk/anthropic` 包内部**已经做好归一化转换：
 * - text 块 → 通用 `text-delta` part；
 * - tool_use 块 + 完整累积的 input_json_delta → 单条 `tool-call` part；
 * - message_stop + stop_reason → `finish-step` part。
 *
 * 因此协议层只需要消费**与 `openai-native` / `openai-compatible` 完全等价**
 * 的 `TextStreamPart` 形态，复用 [`_shared.ts`](./_shared.ts) 的
 * `streamFromTextStreamParts` 即可。三个 adapter 在 stream 转换层完全同构。
 *
 * 三个 adapter 仍保持独立文件的理由：
 * 1. **`protocolID` 是 registry 的路由 key**——不同协议家族的 sdk 工厂、
 *    错误处理策略、未来扩展方向不同；
 * 2. **未来若 `@ai-sdk/anthropic` 协议改动**（例如 prompt caching 元数据、
 *    multi-turn reasoning 块），翻译层放在本文件而不污染 OpenAI adapter。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * 同 openai-native.ts —— 协议层不 dispatch、不 follow-up、不多步循环。
 */

import type { ProtocolAdapter } from "../_types"
import { streamFromTextStreamParts } from "./_shared"

export const AnthropicMessagesProtocol: ProtocolAdapter = {
  protocolID: "anthropic-messages",
  transform: (rawStream) => streamFromTextStreamParts(rawStream),
}
