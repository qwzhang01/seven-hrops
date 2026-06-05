/**
 * Provider 适配层 — `plugins/google.ts`
 *
 * Google Gemini plugin。走 [`@ai-sdk/google`](https://sdk.vercel.ai/providers/ai-sdk-providers/google-generative-ai)
 * 提供的 `createGoogleGenerativeAI` 工厂；协议家族 = `openai-compatible`
 * （Gemini 官方走自己的事件协议，但 `@ai-sdk/google` 包内部已归一化为通用
 * `TextStreamPart`，结构上与 openai-compatible adapter 等价；reasoning-delta
 * 不出现在 Gemini 流中）。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { ProviderPlugin } from "../_types"

export const GooglePlugin: ProviderPlugin = {
  id: "google",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createGoogleGenerativeAI({ apiKey, baseURL, headers })
    return factory(modelID)
  },
}
