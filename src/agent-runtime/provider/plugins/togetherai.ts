/**
 * Provider 适配层 — `plugins/togetherai.ts`
 *
 * TogetherAI plugin。走 [`@ai-sdk/togetherai`](https://sdk.vercel.ai/providers/ai-sdk-providers/togetherai)
 * 提供的 `createTogetherAI` 工厂；协议家族 = `openai-compatible`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createTogetherAI } from "@ai-sdk/togetherai"
import type { ProviderPlugin } from "../_types"

export const TogetherAIPlugin: ProviderPlugin = {
  id: "togetherai",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://api.together.xyz/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createTogetherAI({ apiKey, baseURL, headers })
    return factory(modelID)
  },
}
