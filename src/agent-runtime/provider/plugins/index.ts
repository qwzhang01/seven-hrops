/**
 * Provider 适配层 — `plugins/` barrel
 *
 * 本 barrel 是 ProviderPlugin 家族的对外**唯一**导出面。Registry 与测试代码
 * SHALL 仅从这里导入 plugin 数组与相关类型，不得 deep import 子文件。
 *
 * ## 导出面（阶段 2 定型；阶段 4–5 填实现）
 *
 * ### 类型
 * - `ProviderPlugin`            — plugin 接口（见 `_types.ts`）
 * - `BuiltInProviderID`         — 19 个具名 provider 的 ID 联合
 * - `ProviderID`                — `BuiltInProviderID | "dynamic"`
 *
 * ### 名册
 * - `BUILT_IN_PROVIDER_IDS`     — 19 个具名 ID 的常量数组（registry 自检用）
 * - `ProviderPlugins`           — `readonly ProviderPlugin[]`，阶段 4 填 19 项 + 阶段 5 dynamic
 *
 * ## 阶段进度承接
 *
 * 阶段 4（任务 4.1–4.19）将创建 19 个具名 plugin 文件并在此处导出：
 *   openai / anthropic / google / xai / groq / mistral / cohere / perplexity /
 *   togetherai / deepinfra / openrouter / alibaba / volcengine（豆包） /
 *   deepseek / zhipu / moonshot / lingyiwanwu / hunyuan / ollama
 *
 * 阶段 5（任务 5.1–5.4）将创建 plugins/dynamic.ts（白名单 + 二次确认 + 工厂校验）。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Plugin 的 `createSdk` 仅返回 AI SDK `LanguageModel` 实例。Plugin 层
 * SHALL NOT dispatch 工具、SHALL NOT 拼 follow-up、SHALL NOT 执行多步循环；
 * 这些是 ToolRuntime 的独占职责。
 */

import type { ProviderPlugin } from "../_types"

// ─── 公开类型 re-export ───────────────────────────────────────────────

export type { ProviderPlugin }

// ─── 内置 provider ID 名册（registry 自检 + 错误消息列表化用） ────────

/**
 * 19 个具名 provider ID 的封闭联合。
 *
 * 与 `BUILT_IN_PROVIDER_IDS` 数组保持同步；新增 provider 时两边一起改，
 * 由 [`plugins/_pluginShape.test.ts`](./_pluginShape.test.ts) 在阶段 8.1 强校验。
 */
export type BuiltInProviderID =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "groq"
  | "mistral"
  | "cohere"
  | "perplexity"
  | "togetherai"
  | "deepinfra"
  | "openrouter"
  | "alibaba"
  | "volcengine"
  | "deepseek"
  | "zhipu"
  | "moonshot"
  | "lingyiwanwu"
  | "hunyuan"
  | "ollama"

/**
 * 完整对外 provider ID 联合：19 个具名 + 1 个动态加载入口。
 *
 * `"dynamic"` 走 [`plugins/dynamic.ts`](./dynamic.ts)（阶段 5），
 * 必须配合 `ProviderConfig.dynamicPackage` 字段使用。
 */
export type ProviderID = BuiltInProviderID | "dynamic"

/**
 * 19 个具名 provider 的常量名册。
 *
 * 用途：
 * - Registry 自检：`ProviderPlugins.length === BUILT_IN_PROVIDER_IDS.length`；
 * - `UnknownProviderProtocolError` 错误消息把这个数组列给用户作为可选项；
 * - 配置 UI 下拉框的数据源。
 */
export const BUILT_IN_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "groq",
  "mistral",
  "cohere",
  "perplexity",
  "togetherai",
  "deepinfra",
  "openrouter",
  "alibaba",
  "volcengine",
  "deepseek",
  "zhipu",
  "moonshot",
  "lingyiwanwu",
  "hunyuan",
  "ollama",
] as const satisfies readonly BuiltInProviderID[]

// ─── 19 个具名 plugin 数组 ───────────────────────────────────────────

import { OpenAIPlugin } from "./openai"
import { AnthropicPlugin } from "./anthropic"
import { GooglePlugin } from "./google"
import { XaiPlugin } from "./xai"
import { GroqPlugin } from "./groq"
import { MistralPlugin } from "./mistral"
import { CoherePlugin } from "./cohere"
import { PerplexityPlugin } from "./perplexity"
import { TogetherAIPlugin } from "./togetherai"
import { DeepInfraPlugin } from "./deepinfra"
import { OpenRouterPlugin } from "./openrouter"
import { AlibabaPlugin } from "./alibaba"
import { VolcenginePlugin } from "./volcengine"
import { DeepSeekPlugin } from "./deepseek"
import { ZhipuPlugin } from "./zhipu"
import { MoonshotPlugin } from "./moonshot"
import { LingYiWanWuPlugin } from "./lingyiwanwu"
import { HunyuanPlugin } from "./hunyuan"
import { OllamaPlugin } from "./ollama"

// 具名 re-export，便于测试直接引用单个 plugin（如阶段 8.1 _pluginShape.test.ts）
export { OpenAIPlugin } from "./openai"
export { AnthropicPlugin } from "./anthropic"
export { GooglePlugin } from "./google"
export { XaiPlugin } from "./xai"
export { GroqPlugin } from "./groq"
export { MistralPlugin } from "./mistral"
export { CoherePlugin } from "./cohere"
export { PerplexityPlugin } from "./perplexity"
export { TogetherAIPlugin } from "./togetherai"
export { DeepInfraPlugin } from "./deepinfra"
export { OpenRouterPlugin } from "./openrouter"
export { AlibabaPlugin } from "./alibaba"
export { VolcenginePlugin } from "./volcengine"
export { DeepSeekPlugin } from "./deepseek"
export { ZhipuPlugin } from "./zhipu"
export { MoonshotPlugin } from "./moonshot"
export { LingYiWanWuPlugin } from "./lingyiwanwu"
export { HunyuanPlugin } from "./hunyuan"
export { OllamaPlugin } from "./ollama"

/**
 * 19 个具名 ProviderPlugin 的注册数组。
 *
 * 顺序与 `BUILT_IN_PROVIDER_IDS` 严格一致；`_pluginShape.test.ts` 阶段 8.1 强校验：
 *   ① 长度等于 BUILT_IN_PROVIDER_IDS.length；② 每项 id 与同位置 ID 字面量相同。
 *
 * Registry 解析任意具名 providerID 时遍历此数组按 `id` 匹配；找不到则进入
 * "未知 providerID" fail-fast 分支（`UnknownProviderProtocolError`）。
 */
export const ProviderPlugins: readonly ProviderPlugin[] = [
  OpenAIPlugin,
  AnthropicPlugin,
  GooglePlugin,
  XaiPlugin,
  GroqPlugin,
  MistralPlugin,
  CoherePlugin,
  PerplexityPlugin,
  TogetherAIPlugin,
  DeepInfraPlugin,
  OpenRouterPlugin,
  AlibabaPlugin,
  VolcenginePlugin,
  DeepSeekPlugin,
  ZhipuPlugin,
  MoonshotPlugin,
  LingYiWanWuPlugin,
  HunyuanPlugin,
  OllamaPlugin,
] as const

// ─── Dynamic provider resolver（独立分支，不进入 ProviderPlugins[]） ──

export {
  resolveDynamicProvider,
  DYNAMIC_PACKAGE_WHITELIST,
  DYNAMIC_PROTOCOL,
  type ResolveDynamicProviderOptions,
  type ResolvedDynamicProvider,
} from "./dynamic"

// 注：dynamic resolver **不**进入 `ProviderPlugins` 数组（它是按
//   providerID === "dynamic" 走另一条解析分支），由 [`registry.ts`](../registry.ts)
//   单独 import 上面 re-export 的 `resolveDynamicProvider`。
