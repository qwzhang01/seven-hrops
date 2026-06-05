/**
 * Provider 适配层 — `plugins/alibaba.ts`
 *
 * Alibaba 通义千问 (Qwen) plugin。走 [`@ai-sdk/alibaba`](https://sdk.vercel.ai/providers/ai-sdk-providers/alibaba)
 * 提供的 `createAlibaba` 工厂；协议家族 = `openai-compatible`。
 *
 * **关于 promptStyle**：Qwen 部分模型卡（如 `qwen-plus` / `qwen-turbo`）原生
 * 支持 OpenAI function-calling，无需 prompt-style 装饰器；但 `qwen3-coder` 等
 * 部分模型卡只支持 `<tool_call>...</tool_call>` 编码——这种情况下用户需在
 * `ProviderConfig.promptStyle` 显式置为 `"qwen"`。Plugin 默认不挂载装饰器
 * 以避免对原生 function-calling 模型卡造成误伤。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。
 */

import { createAlibaba } from "@ai-sdk/alibaba"
import type { ProviderPlugin } from "../_types"

export const AlibabaPlugin: ProviderPlugin = {
  id: "alibaba",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  // promptStyle 不默认挂载；用户为非原生 function-calling 模型卡显式置 "qwen"
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createAlibaba({ apiKey, baseURL, headers })
    return factory(modelID)
  },
}
