/**
 * Provider 适配层 — `plugins/cohere.ts`
 *
 * Cohere plugin。走 [`@ai-sdk/cohere`](https://sdk.vercel.ai/providers/ai-sdk-providers/cohere)
 * 提供的 `createCohere` 工厂；协议家族 = `openai-compatible`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createCohere } from "@ai-sdk/cohere"
import type { ProviderPlugin } from "../_types"

export const CoherePlugin: ProviderPlugin = {
  id: "cohere",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://api.cohere.com/v2",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createCohere({ apiKey, baseURL, headers })
    return factory(modelID)
  },
}
