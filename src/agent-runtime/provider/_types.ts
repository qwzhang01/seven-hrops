/**
 * Provider 协议适配层 — 核心类型契约
 *
 * 本文件定义 `ProviderRegistry × ProtocolAdapter × ProviderPlugin` 三层抽象的
 * 类型骨架，是 runtime-multimodel-protocol-adapter change 的核心契约入口。
 *
 * 设计来源：
 * - 参考 opencode `packages/opencode/src/provider/` 的 plugin × protocol 分层。
 * - 适配 Vercel AI SDK v6 的 `streamText` / `LanguageModelV2` 协议家族。
 *
 * 单一 agent loop 不变量（arch-runtime-single-loop）：
 *   ProtocolAdapter 仅做"raw stream → LLMStreamEvent"的归一化转换，
 *   绝不在适配层 dispatch 工具、绝不拼 follow-up、绝不多步循环 LLM。
 *   工具调度由 ToolRuntime 独占。
 */

import type { Stream } from "effect"
import { Schema } from "effect"
import type { TextStreamPart } from "ai"
import type { LLMStreamEvent } from "../agent/tool-runtime"
import type { ProviderConfig } from "../config/index"

// ─── 协议与提示风格的封闭联合（capability allowlist） ─────────────────

/**
 * 三大协议家族 ID。新增协议家族时同步更新本联合 + protocols/index.ts barrel。
 *
 * - `openai-native`：OpenAI 官方协议，含 reasoning-delta、tool-call streaming。
 * - `openai-compatible`：兼容协议（无 reasoning），覆盖 14+ 国内外 OpenAI 兼容厂商。
 * - `anthropic-messages`：Anthropic Messages 协议，事件形态与 OpenAI 不同
 *   （`content-block-start` / `content-block-delta` / `message-stop` 等）。
 */
export type ProtocolID =
  | "openai-native"
  | "openai-compatible"
  | "anthropic-messages"

/**
 * Prompt-style 工具调用风格 ID（通过装饰器叠加在 ProtocolAdapter 上）。
 *
 * 这些模型不走标准 function-calling，而是把工具调用编码成
 * `<|FunctionCallBegin|>...<|FunctionCallEnd|>` 这类伪 token 嵌在 text-delta 里。
 * 装饰器从 raw text-delta 中识别 token、累积、整流为 LLMStreamEvent.tool-call。
 *
 * - `doubao`：火山方舟豆包系列模型卡指定的 prompt-style 编码。
 * - `qwen`：阿里通义 Qwen 系列模型卡指定的 `<tool_call>` 编码。
 *
 * 新增风格时：① 联合追加；② TOKEN_PATTERNS 常量表追加；③ 装饰器测试追加。
 */
export type PromptStyleID = "doubao" | "qwen"

/**
 * Dynamic provider 仅允许加载的 npm 包前缀。
 *
 * 配合 plugins/dynamic.ts 的 DYNAMIC_PACKAGE_WHITELIST 正则
 * (`/^@ai-sdk\/[a-z0-9-]+$/`) 双重锁紧。
 * 类型层提示用户："必须以 @ai-sdk/ 开头"。
 */
export type DynamicPackage = `@ai-sdk/${string}`

// ─── ProtocolAdapter 契约 ────────────────────────────────────────────

/**
 * ProtocolAdapter — 把 AI SDK 的 raw `TextStreamPart` 流转换为内部 `LLMStreamEvent` 流。
 *
 * 不变量：
 * - 仅做 stream → stream 的纯函数式转换，无 IO 副作用。
 * - 不持有任何 ToolRuntime / Session / Provider 引用。
 * - 一切 reasoning / tool-call / finish / abort 事件归一化为 LLMStreamEvent。
 */
export interface ProtocolAdapter {
  readonly protocolID: ProtocolID
  readonly transform: (
    rawStream: AsyncIterable<TextStreamPart<Record<string, never>>>,
  ) => Stream.Stream<LLMStreamEvent, Error>
}

// ─── ProviderPlugin 契约 ─────────────────────────────────────────────

/**
 * ProviderPlugin — 单个 LLM 服务商的薄壳定义（15-40 行）。
 *
 * 每个 plugin 仅声明：
 * - 哪个 npm 包提供 SDK 工厂；
 * - 默认协议 / 默认 baseURL / 默认 promptStyle（可选）；
 * - 一个 `createSdk` 函数把 `ProviderConfig` 转换成 AI SDK `LanguageModel` 实例。
 *
 * Plugin 不参与 stream 转换、不参与工具 dispatch；那些事归 ProtocolAdapter / ToolRuntime。
 */
export interface ProviderPlugin {
  /** Provider 唯一 ID，与 ProviderConfig 的 providerID 对齐（如 "openai" / "volcengine"）。 */
  readonly id: string
  /** 缺省协议家族；config.protocol 显式给出时覆盖此默认。 */
  readonly defaultProtocol: ProtocolID
  /** 缺省 baseURL；config.baseURL 显式给出时覆盖此默认。 */
  readonly defaultBaseURL: string
  /** 可选：缺省 prompt-style 装饰器（如 volcengine → "doubao"）。 */
  readonly promptStyle?: PromptStyleID
  /** SDK 工厂：把配置转成 AI SDK LanguageModel 实例。返回值 unknown 由 streamText 内部 narrow。 */
  readonly createSdk: (options: {
    apiKey?: string
    baseURL: string
    headers?: Record<string, string>
    modelID: string
  }) => unknown
}

// ─── ProviderRegistry 契约 ───────────────────────────────────────────

/**
 * ProviderRegistry.resolve 的返回值。
 *
 * - `sdkInstance`：AI SDK `LanguageModel` 实例，传入 `streamText({ model })`。
 * - `adapter`：选好的 ProtocolAdapter（必要时已套上 prompt-style 装饰器）。
 * - `promptStyle`：若非 null，表示该模型使用 prompt-style 工具调用编码，
 *   调用方需要在构造 follow-up 消息时把 tool-call/tool-result 消息扁平化为
 *   纯文本格式（因为这类模型不支持原生 function-calling 的消息 schema）。
 */
export interface ResolvedProvider {
  readonly sdkInstance: unknown
  readonly adapter: ProtocolAdapter
  readonly promptStyle: PromptStyleID | null
}

/**
 * `ProviderRegistry.resolve` 的可选参数袋——专为 `providerID === "dynamic"` 路径
 * 服务的依赖注入入口。19 个具名 provider 走解析时这些字段被忽略；走 dynamic
 * 分支时各字段语义见各自字段注释。
 *
 * 该可选参数袋的存在让同一个 `resolve` 签名既能服务 19 个具名 provider 的"零
 * 配置同步式"使用习惯（调用方只关心 providerID/config/modelID），又能在
 * dynamic 路径上注入 workspace + 确认回调，避免把 dynamic 分支劈成独立 API
 * 让调用方被迫感知两套形态。
 */
export interface ResolveOptions {
  /**
   * 当前 workspace 绝对路径。当 `providerID === "dynamic"` 且首次加载某个包
   * 时，registry 会把信任记录写入 `<workspacePath>/.config/dynamic-providers-trusted.json`；
   * 传 `null` 时降级为"本次确认但不持久化"。
   */
  readonly workspacePath?: string | null
  /**
   * 二次确认回调。生产环境传 `undefined` 走 [`requestUserConfirmation`](../../platform/dynamicProviderTrust.ts)
   * 弹 Tauri 原生对话框；vitest 测试场景注入 `async () => true/false` 跳过原生 UI。
   */
  readonly confirmCallback?: (packageName: string) => Promise<boolean>
  /**
   * 环境变量读取器。默认走 `process.env`（Node/Vitest）；Vite/浏览器场景
   * 自动降级为返回 undefined（即不启用 `OPENSPEC_DYNAMIC_TRUST` 短路）。
   */
  readonly readEnv?: (key: string) => string | undefined
}

/**
 * ProviderRegistry — 唯一解析入口。
 *
 * 给 (providerID, config, modelID) → 拼装出 (sdkInstance, adapter)。
 * Service 层 / Component 层 SHALL NOT 绕过 registry 直接 import plugin。
 *
 * **签名为 async** —— 因为 dynamic 路径需要 `await import(packageName)` +
 * `await checkTrust(...)`；19 个具名 provider 的同步路径也统一封装在 Promise
 * 里以保持调用方单一 await 形态（`const { sdkInstance } = await registry.resolve(...)`）。
 */
export interface ProviderRegistry {
  readonly resolve: (
    providerID: string,
    config: ProviderConfig,
    modelID: string,
    options?: ResolveOptions,
  ) => Promise<ResolvedProvider>
}

// ─── 错误类型（Effect-TS Schema.TaggedErrorClass 风格） ───────────────

/** 配置了未知 providerID 且未指定 protocol，无法回退。 */
export class UnknownProviderProtocolError extends Schema.TaggedErrorClass<UnknownProviderProtocolError>()(
  "UnknownProviderProtocolError",
  {
    providerID: Schema.String,
    knownProviderIDs: Schema.Array(Schema.String),
  },
) {}

/** Dynamic provider 配置的 npm 包不在白名单内（不以 @ai-sdk/ 开头）。 */
export class DynamicProviderNotAllowedError extends Schema.TaggedErrorClass<DynamicProviderNotAllowedError>()(
  "DynamicProviderNotAllowedError",
  {
    packageName: Schema.String,
    reason: Schema.String,
  },
) {}

/** Dynamic provider 配置缺失 dynamicPackage 字段。 */
export class DynamicProviderMissingPackageError extends Schema.TaggedErrorClass<DynamicProviderMissingPackageError>()(
  "DynamicProviderMissingPackageError",
  {
    providerID: Schema.String,
  },
) {}

/** 加载的包内找不到任何 createXxx 工厂函数。 */
export class DynamicProviderNoFactoryError extends Schema.TaggedErrorClass<DynamicProviderNoFactoryError>()(
  "DynamicProviderNoFactoryError",
  {
    packageName: Schema.String,
    availableExports: Schema.Array(Schema.String),
  },
) {}

/** 工厂函数返回值不满足 LanguageModel 最小形态（缺 specificationVersion / provider / modelId）。 */
export class DynamicProviderInvalidFactoryError extends Schema.TaggedErrorClass<DynamicProviderInvalidFactoryError>()(
  "DynamicProviderInvalidFactoryError",
  {
    packageName: Schema.String,
    factoryName: Schema.String,
    missingFields: Schema.Array(Schema.String),
  },
) {}

/** 用户在二次确认对话框中拒绝信任该 dynamic 包。 */
export class DynamicProviderUserDeclinedError extends Schema.TaggedErrorClass<DynamicProviderUserDeclinedError>()(
  "DynamicProviderUserDeclinedError",
  {
    packageName: Schema.String,
  },
) {}
