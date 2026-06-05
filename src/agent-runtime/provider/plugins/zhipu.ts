/**
 * Provider 适配层 — `plugins/zhipu.ts`
 *
 * 智谱 GLM plugin（OpenAI-Compatible 协议）。走通用 `createOpenAICompatible`
 * 工厂；智谱 API 兼容 OpenAI 接口规范，原生支持 function-calling。
 *
 * 模型代表：`glm-4` / `glm-4-plus` / `glm-4-flash`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { ProviderPlugin } from "../_types"

export const ZhipuPlugin: ProviderPlugin = {
  id: "zhipu",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://open.bigmodel.cn/api/paas/v4",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createOpenAICompatible({
      name: "zhipu",
      apiKey,
      baseURL,
      headers,
    })
    return factory(modelID)
  },
}
