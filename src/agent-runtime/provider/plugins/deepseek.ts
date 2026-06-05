/**
 * Provider 适配层 — `plugins/deepseek.ts`
 *
 * DeepSeek plugin（OpenAI-Compatible 协议）。走通用 `createOpenAICompatible`
 * 工厂；DeepSeek API 完全兼容 OpenAI（含 function-calling），无需 prompt-style
 * 装饰器。
 *
 * 模型代表：`deepseek-chat` / `deepseek-coder` / `deepseek-reasoner`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { ProviderPlugin } from "../_types"

export const DeepSeekPlugin: ProviderPlugin = {
  id: "deepseek",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://api.deepseek.com/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createOpenAICompatible({
      name: "deepseek",
      apiKey,
      baseURL,
      headers,
    })
    return factory(modelID)
  },
}
