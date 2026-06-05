/**
 * Provider 适配层 — `plugins/deepinfra.ts`
 *
 * DeepInfra plugin。走 [`@ai-sdk/deepinfra`](https://sdk.vercel.ai/providers/ai-sdk-providers/deepinfra)
 * 提供的 `createDeepInfra` 工厂；协议家族 = `openai-compatible`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createDeepInfra } from "@ai-sdk/deepinfra"
import type { ProviderPlugin } from "../_types"

export const DeepInfraPlugin: ProviderPlugin = {
  id: "deepinfra",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://api.deepinfra.com/v1/openai",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createDeepInfra({ apiKey, baseURL, headers })
    return factory(modelID)
  },
}
