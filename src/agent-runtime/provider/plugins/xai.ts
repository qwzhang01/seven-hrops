/**
 * Provider 适配层 — `plugins/xai.ts`
 *
 * xAI Grok plugin。走 [`@ai-sdk/xai`](https://sdk.vercel.ai/providers/ai-sdk-providers/xai-grok)
 * 提供的 `createXai` 工厂；协议家族 = `openai-compatible`（xAI 接口与 OpenAI
 * 兼容，事件谱相同）。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createXai } from "@ai-sdk/xai"
import type { ProviderPlugin } from "../_types"

export const XaiPlugin: ProviderPlugin = {
  id: "xai",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://api.x.ai/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createXai({ apiKey, baseURL, headers })
    return factory(modelID)
  },
}
