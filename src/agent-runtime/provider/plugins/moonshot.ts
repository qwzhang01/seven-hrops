/**
 * Provider 适配层 — `plugins/moonshot.ts`
 *
 * 月之暗面 Kimi plugin（OpenAI-Compatible 协议）。走通用 `createOpenAICompatible`
 * 工厂；Moonshot API 兼容 OpenAI 接口规范，原生支持 function-calling。
 *
 * 模型代表：`moonshot-v1-8k` / `moonshot-v1-32k` / `moonshot-v1-128k`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { ProviderPlugin } from "../_types"

export const MoonshotPlugin: ProviderPlugin = {
  id: "moonshot",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://api.moonshot.cn/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createOpenAICompatible({
      name: "moonshot",
      apiKey,
      baseURL,
      headers,
    })
    return factory(modelID)
  },
}
