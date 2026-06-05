/**
 * Provider 适配层 — `plugins/groq.ts`
 *
 * Groq plugin。走 [`@ai-sdk/groq`](https://sdk.vercel.ai/providers/ai-sdk-providers/groq)
 * 提供的 `createGroq` 工厂；协议家族 = `openai-compatible`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createGroq } from "@ai-sdk/groq"
import type { ProviderPlugin } from "../_types"

export const GroqPlugin: ProviderPlugin = {
  id: "groq",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://api.groq.com/openai/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createGroq({ apiKey, baseURL, headers })
    return factory(modelID)
  },
}
