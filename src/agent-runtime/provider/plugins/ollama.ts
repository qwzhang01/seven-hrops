/**
 * Provider 适配层 — `plugins/ollama.ts`
 *
 * Ollama 本地推理 plugin（OpenAI-Compatible 协议）。走通用 `createOpenAICompatible`
 * 工厂；Ollama 在 `localhost:11434/v1` 暴露 OpenAI 兼容接口。
 *
 * 模型代表：`qwen3:8b` / `llama3.2:3b` / `gemma2:2b` 等本地拉取的任意模型 tag。
 *
 * ## 关于 apiKey
 *
 * Ollama 本地实例**不需要 apiKey**，但 `@ai-sdk/openai-compatible` 工厂在
 * apiKey 为 `undefined` 时仍会工作（不会强制注入 Authorization header）。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { ProviderPlugin } from "../_types"

export const OllamaPlugin: ProviderPlugin = {
  id: "ollama",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "http://localhost:11434/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createOpenAICompatible({
      name: "ollama",
      apiKey, // 本地实例可缺省
      baseURL,
      headers,
    })
    return factory(modelID)
  },
}
