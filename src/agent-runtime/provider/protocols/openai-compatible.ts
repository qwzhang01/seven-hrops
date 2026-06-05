/**
 * Provider 协议适配层 — `protocols/openai-compatible.ts`
 *
 * **OpenAI-Compatible 协议** adapter。处理 `@ai-sdk/openai-compatible` 工厂
 * （或 `createOpenAI` + 自定义 baseURL）产出的 raw stream。
 *
 * 与 [`openai-native.ts`](./openai-native.ts) 在 stream 转换层**行为完全等价**——
 * 二者共用 [`_shared.ts`](./_shared.ts) 的 `streamFromTextStreamParts` helper，
 * 由 [`protocols/openai-compatible.test.ts`](./openai-compatible.test.ts)（阶段 7.2）
 * 显式断言"相同输入产出相同 LLMStreamEvent 序列"作为契约测试。
 *
 * 保留独立文件是为了：
 * 1. **协议家族身份显式化**：`protocolID === "openai-compatible"` 是
 *    [`registry.ts`](../registry.ts) 路由的关键字段，让"豆包是兼容协议而非
 *    OpenAI 原生协议"这件事在代码层面有显式表达。
 * 2. **prompt-style 装饰器挂载点**：豆包 / Qwen 等模型走兼容协议但需要
 *    `withPromptStyleToolCall` 装饰，registry 仅对 `protocolID === "openai-compatible"`
 *    + `promptStyle` 非空的组合套装饰器。
 * 3. **未来差异化预留**：OpenAI-Compatible 部分厂商对 `finish-step` 的
 *    `finishReason` 取值与 OpenAI 官方略有差异；如果将来需要兼容修正，
 *    就在本文件加翻译层而不污染 native adapter。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * 同 openai-native.ts —— 协议层不 dispatch、不 follow-up、不多步循环。
 */

import type { ProtocolAdapter } from "../_types"
import { streamFromTextStreamParts } from "./_shared"

export const OpenAICompatibleProtocol: ProtocolAdapter = {
  protocolID: "openai-compatible",
  transform: (rawStream) => streamFromTextStreamParts(rawStream),
}
