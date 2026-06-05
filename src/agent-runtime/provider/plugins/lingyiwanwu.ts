/**
 * Provider 适配层 — `plugins/lingyiwanwu.ts`
 *
 * 零一万物 Yi plugin（OpenAI-Compatible 协议）。走通用 `createOpenAICompatible`
 * 工厂；零一万物 API 兼容 OpenAI 接口规范，原生支持 function-calling。
 *
 * 模型代表：`yi-large` / `yi-medium` / `yi-vision`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { ProviderPlugin } from "../_types"

export const LingYiWanWuPlugin: ProviderPlugin = {
  id: "lingyiwanwu",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://api.lingyiwanwu.com/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createOpenAICompatible({
      name: "lingyiwanwu",
      apiKey,
      baseURL,
      headers,
    })
    return factory(modelID)
  },
}
