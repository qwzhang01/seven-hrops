/**
 * Provider 适配层 — `plugins/openrouter.ts`
 *
 * OpenRouter plugin（OpenAI-Compatible 协议家族）。
 *
 * 不依赖独立 `@ai-sdk/openrouter` 包（社区有但维护活跃度不及官方包族），
 * 走通用 [`@ai-sdk/openai-compatible`](https://sdk.vercel.ai/providers/openai-compatible)
 * 的 `createOpenAICompatible` 工厂；OpenRouter API 与 OpenAI 完全兼容
 * （仅 baseURL 不同 + 可选 `HTTP-Referer` / `X-Title` headers 用于排行榜）。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { ProviderPlugin } from "../_types"

export const OpenRouterPlugin: ProviderPlugin = {
  id: "openrouter",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://openrouter.ai/api/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createOpenAICompatible({
      name: "openrouter",
      apiKey,
      baseURL,
      headers,
    })
    return factory(modelID)
  },
}
