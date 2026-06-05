/**
 * Provider 适配层 — `plugins/mistral.ts`
 *
 * Mistral plugin。走 [`@ai-sdk/mistral`](https://sdk.vercel.ai/providers/ai-sdk-providers/mistral)
 * 提供的 `createMistral` 工厂；协议家族 = `openai-compatible`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createMistral } from "@ai-sdk/mistral"
import type { ProviderPlugin } from "../_types"

export const MistralPlugin: ProviderPlugin = {
  id: "mistral",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://api.mistral.ai/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createMistral({ apiKey, baseURL, headers })
    return factory(modelID)
  },
}
