/**
 * Provider 适配层 — `plugins/openai.ts`
 *
 * OpenAI 官方 plugin。走 [`@ai-sdk/openai`](https://sdk.vercel.ai/providers/ai-sdk-providers/openai)
 * 提供的 `createOpenAI` 工厂；协议家族 = `openai-native`（含 `reasoning-delta`，
 * 仅本 plugin 默认协议会出现该事件）。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createOpenAI } from "@ai-sdk/openai"
import type { ProviderPlugin } from "../_types"

export const OpenAIPlugin: ProviderPlugin = {
  id: "openai",
  defaultProtocol: "openai-native",
  defaultBaseURL: "https://api.openai.com/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createOpenAI({ apiKey, baseURL, headers })
    return factory(modelID)
  },
}
