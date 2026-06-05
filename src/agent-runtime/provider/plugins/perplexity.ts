/**
 * Provider 适配层 — `plugins/perplexity.ts`
 *
 * Perplexity plugin。走 [`@ai-sdk/perplexity`](https://sdk.vercel.ai/providers/ai-sdk-providers/perplexity)
 * 提供的 `createPerplexity` 工厂；协议家族 = `openai-compatible`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createPerplexity } from "@ai-sdk/perplexity"
import type { ProviderPlugin } from "../_types"

export const PerplexityPlugin: ProviderPlugin = {
  id: "perplexity",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://api.perplexity.ai",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createPerplexity({ apiKey, baseURL, headers })
    return factory(modelID)
  },
}
