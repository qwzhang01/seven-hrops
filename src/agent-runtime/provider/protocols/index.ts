/**
 * Provider 协议适配层 — `protocols/` barrel
 *
 * 本 barrel 是 ProtocolAdapter 家族的对外**唯一**导出面。Registry / Plugin /
 * 测试代码 SHALL 仅从这里导入 adapter 与相关类型，不得反向 deep import 子文件。
 *
 * ## 导出面（阶段 3 已落地真实实现）
 *
 * ### 类型
 * - `ProtocolAdapter`         — adapter 接口（见 `_types.ts`）
 * - `ProtocolID`              — 协议家族 ID 联合
 * - `PromptStyleID`           — prompt-style 装饰器 ID 联合
 *
 * ### 三个具名 adapter
 * - `OpenAINativeProtocol`     — OpenAI 官方协议（含 reasoning-delta）
 * - `OpenAICompatibleProtocol` — 兼容协议（覆盖国产 + 通用兼容厂商）
 * - `AnthropicMessagesProtocol`— Anthropic Messages 协议
 *
 * ### 一个装饰器
 * - `withPromptStyleToolCall(inner, style)` —
 *   把 prompt-style 编码（豆包 / qwen）整流为 LLMStreamEvent.tool-call。
 *
 * ### 名册
 * - `ProtocolAdapters: Record<ProtocolID, ProtocolAdapter>` — registry 路由查表用
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * 所有 adapter SHALL 仅做 stream → stream 的纯函数式转换。任何 dispatch /
 * follow-up / 多步 LLM 调度 SHALL 由 ToolRuntime 独占，protocol 层禁止染指。
 */

import type {
  ProtocolAdapter,
  ProtocolID,
  PromptStyleID,
} from "../_types"
import { OpenAINativeProtocol } from "./openai-native"
import { OpenAICompatibleProtocol } from "./openai-compatible"
import { AnthropicMessagesProtocol } from "./anthropic-messages"
import { withPromptStyleToolCall } from "./prompt-style-tool-call"

// ─── 公开类型 re-export ───────────────────────────────────────────────

export type { ProtocolAdapter, ProtocolID, PromptStyleID }

// ─── 三个具名 adapter ────────────────────────────────────────────────

export { OpenAINativeProtocol } from "./openai-native"
export { OpenAICompatibleProtocol } from "./openai-compatible"
export { AnthropicMessagesProtocol } from "./anthropic-messages"

// ─── prompt-style 装饰器 ─────────────────────────────────────────────

export { withPromptStyleToolCall } from "./prompt-style-tool-call"
export { TOKEN_PATTERNS, MAX_TOKEN_LEN } from "./prompt-style-tool-call"

// ─── 名册（registry 与测试用） ────────────────────────────────────────

/**
 * 协议 ID → ProtocolAdapter 映射表。
 *
 * Registry 通过 protocolID 查这张表选择 adapter。新增协议家族时：
 *   ① _types.ts 的 ProtocolID 联合追加；
 *   ② 在 protocols/ 下新增对应文件；
 *   ③ 本 barrel 的 export + 本表的 entry 同步追加。
 */
export const ProtocolAdapters: Readonly<Record<ProtocolID, ProtocolAdapter>> =
  Object.freeze({
    "openai-native": OpenAINativeProtocol,
    "openai-compatible": OpenAICompatibleProtocol,
    "anthropic-messages": AnthropicMessagesProtocol,
  })

// 保留供未来 deep-import 防呆校验：装饰器入口未被使用时让 typecheck 抓到。
void withPromptStyleToolCall
