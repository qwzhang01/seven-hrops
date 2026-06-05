/**
 * Provider 适配层 — `plugins/hunyuan.ts`
 *
 * 腾讯混元 plugin（OpenAI-Compatible 协议）。走通用 `createOpenAICompatible`
 * 工厂；腾讯混元提供 OpenAI 兼容接口（hunyuan.tencentcloudapi.com 的 OpenAI
 * 兼容入口）。
 *
 * 模型代表：`hunyuan-pro` / `hunyuan-standard` / `hunyuan-turbo`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { ProviderPlugin } from "../_types"

export const HunyuanPlugin: ProviderPlugin = {
  id: "hunyuan",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://api.hunyuan.cloud.tencent.com/v1",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createOpenAICompatible({
      name: "hunyuan",
      apiKey,
      baseURL,
      headers,
    })
    return factory(modelID)
  },
}
