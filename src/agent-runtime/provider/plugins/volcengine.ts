/**
 * Provider 适配层 — `plugins/volcengine.ts`
 *
 * **火山方舟（豆包）** plugin。整个 `runtime-multimodel-protocol-adapter`
 * 变更的**核心治本对象**——豆包工具调用问题就是用本 plugin + prompt-style
 * 装饰器组合解决的。
 *
 * ## 协议形态
 *
 * - 协议家族：`openai-compatible`（火山方舟使用 OpenAI 兼容接口）
 * - SDK 工厂：[`@ai-sdk/openai-compatible`](https://sdk.vercel.ai/providers/openai-compatible)
 *   的 `createOpenAICompatible`（无独立 `@ai-sdk/volcengine` 包）
 * - **默认 promptStyle = `"doubao"`** — registry 路由时会自动给 inner adapter
 *   套上 [`withPromptStyleToolCall`](../protocols/prompt-style-tool-call.ts) 装饰器
 *
 * ## 关于 prompt-style 默认挂载
 *
 * 豆包系列模型（doubao-1.5-pro / doubao-1.5-vision / doubao-pro 等）**全部**
 * 把工具调用编码为 `<|FunctionCallBegin|>...<|FunctionCallEnd|>` 文本流——
 * 没有原生 function-calling 模型卡。因此本 plugin 默认即挂载装饰器是安全的，
 * 用户也可在 `ProviderConfig.promptStyle: null` 显式关闭（用于纯文本对话场景）。
 *
 * 模型卡官方文档：
 *   https://www.volcengine.com/docs/82379/1330310（豆包 1.5 模型卡）
 *
 * ## baseURL
 *
 * 火山方舟有两条入口路径，本 plugin 取通用入口：
 *   `https://ark.cn-beijing.volces.com/api/v3`（北京区域 OpenAI 兼容入口）
 *
 * 其他区域（如新加坡）用户可在 `ProviderConfig.baseURL` 显式覆盖。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 仅返回 LanguageModel 实例，不参与工具 dispatch。装饰器叠加由
 * [`registry.ts`](../registry.ts) 在 resolve 阶段完成。
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { ProviderPlugin } from "../_types"

export const VolcenginePlugin: ProviderPlugin = {
  id: "volcengine",
  defaultProtocol: "openai-compatible",
  defaultBaseURL: "https://ark.cn-beijing.volces.com/api/v3",
  promptStyle: "doubao",
  createSdk: ({ apiKey, baseURL, headers, modelID }) => {
    const factory = createOpenAICompatible({
      name: "volcengine",
      apiKey,
      baseURL,
      headers,
    })
    return factory(modelID)
  },
}
