/**
 * Provider 适配层 — `plugins/anthropic.ts`
 *
 * Anthropic 官方 plugin。走 [`@ai-sdk/anthropic`](https://sdk.vercel.ai/providers/ai-sdk-providers/anthropic)
 * 提供的 `createAnthropic` 工厂；协议家族 = `anthropic-messages`。
 *
 * 关键发现（详见 [`protocols/anthropic-messages.ts`](../protocols/anthropic-messages.ts) 头注释）：
 * Anthropic 的原始 SSE 协议（`content_block_*` / `input_json_delta` / `message_stop`）
 * 已被 `@ai-sdk/anthropic` 包内部归一化为通用 `TextStreamPart`，所以协议层
 * 直接复用 `streamFromTextStreamParts`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createAnthropic } from "@ai-sdk/anthropic"
import type { ProviderPlugin } from "../_types"

export const AnthropicPlugin: ProviderPlugin = {
  id: "anthropic",
  defaultProtocol: "anthropic-messages",
  defaultBaseURL: "https://api.anthropic.com/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createAnthropic({ apiKey, baseURL, headers })
    return factory(modelID)
  },
}
