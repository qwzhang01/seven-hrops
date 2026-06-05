/**
 * Provider 适配层 — `plugins/dynamic.ts`
 *
 * **DynamicProviderPlugin** —— 长尾 LLM provider 的运行时反射加载器。借鉴自
 * opencode `packages/opencode/src/provider/dynamic.ts` 的"杀手级特性"：
 * 不预先列举 provider，用户在 ProviderConfig 中声明 npm 包名，运行时反射 SDK 工厂、
 * 套上 OpenAI-Compatible 协议适配器、即得能力。
 *
 * ## 与 19 个具名 plugin 的本质差异
 *
 * | 维度 | 具名 plugin（19 个） | DynamicProviderPlugin |
 * |------|---------------------|-----------------------|
 * | 接口形态 | 同步 [`ProviderPlugin`](../_types.ts) | 独立异步 [`DynamicProviderResolver`](#) |
 * | 加载时机 | 启动期静态 import | 首次解析时 `await import()` |
 * | 安全护栏 | 无（npm 包是项目依赖，已审过） | 白名单 + 二次确认 + 工厂校验三重护栏 |
 * | 进入 ProviderPlugins[]? | ✅ | ❌（registry 走 `if providerID === "dynamic"` 分支） |
 *
 * ## 三重安全护栏（platform-foundation 纪律 3.3）
 *
 * 1. **包名白名单** `^@ai-sdk/[a-z0-9-]+$` — 在 `import()` 之前 fail-fast；
 *    阻止恶意配置加载任意 npm 包导致供应链攻击。
 * 2. **首次加载二次确认** — 通过 [`dynamicProviderTrust`](../../../platform/dynamicProviderTrust.ts)
 *    模块走 Tauri 原生 `confirm` 对话框；用户确认后写入 workspace 级
 *    `.config/dynamic-providers-trusted.json`。
 * 3. **工厂返回值最小形态校验** — 反射出的 `createXxx` 工厂返回值必须具备
 *    `specificationVersion` / `provider` / `modelId` 三个字段（Vercel AI SDK
 *    `LanguageModelV*` 必要字段），不通过则抛 `DynamicProviderInvalidFactoryError`。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * 与 19 个具名 plugin 一致——本模块仅返回 `LanguageModel` 实例，不参与工具
 * dispatch、不持有 ToolRuntime 引用、不实现 agent loop。
 *
 * ## 分层纪律
 *
 * 本文件**不**直接 `import { useWorkspaceStore }`：workspace path 由调用方
 * （registry 路径上更高层的 service / store）通过 `resolveDynamicProvider` 的
 * options 显式传入，保持 agent-runtime 与前端 store 解耦——这与本仓 agent-runtime/
 * 全模块 0 处 import store 的现状一致。
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import {
  checkTrust,
  markTrusted,
  requestUserConfirmation,
  type TrustOptions,
} from "../../../platform/dynamicProviderTrust"
import {
  DynamicProviderInvalidFactoryError,
  DynamicProviderMissingPackageError,
  DynamicProviderNoFactoryError,
  DynamicProviderNotAllowedError,
  DynamicProviderUserDeclinedError,
  type DynamicPackage,
  type ProtocolID,
} from "../_types"
import type { ProviderConfig } from "../../config/index"

// ─── Constants ────────────────────────────────────────────────────────

/**
 * 动态加载白名单正则。**仅**接受 `@ai-sdk/<kebab-case>` 形态的 npm 包名。
 *
 * 任何修改本正则放宽匹配范围（例如改成"匹配任意字符"或移除 `@ai-sdk/` 前缀约束）
 * 的 PR 都 SHALL 在 code review 中被拒绝——这是 platform-foundation 纪律 3.3
 * 的硬性供应链信任边界。
 *
 * 之所以采用字面量正则而非 `new RegExp(...)`：
 * - 编译期常量，能在静态分析工具中被识别为「敏感字符串」
 * - 不可被运行时配置覆写
 */
export const DYNAMIC_PACKAGE_WHITELIST = /^@ai-sdk\/[a-z0-9-]+$/

/**
 * 动态加载的协议家族固定为 `openai-compatible`。
 *
 * 理由：白名单内的 `@ai-sdk/*` 包大多遵循 OpenAI-Compatible wire-protocol
 * （否则它们会有自己的非 OpenAI 协议实现，那也不会通过 `createXxx` 直接吐出
 * 兼容形态）。这是 opencode dynamic.ts 的同样假设。
 *
 * 若未来出现走 anthropic-messages 或别的协议家族的白名单包，可在 plugin 反射
 * 阶段读取包元数据决定 protocolID——但当前 MVP 不做此事。
 */
export const DYNAMIC_PROTOCOL: ProtocolID = "openai-compatible"

// ─── Types ────────────────────────────────────────────────────────────

/**
 * `resolveDynamicProvider` 的入参。`workspacePath` / `readEnv` 透传给
 * [`dynamicProviderTrust`](../../../platform/dynamicProviderTrust.ts)；
 * `confirmCallback` 允许测试场景注入假对话框。
 */
export interface ResolveDynamicProviderOptions {
  readonly config: ProviderConfig
  readonly modelID: string
  readonly workspacePath: string | null
  /** 默认走 process.env / import.meta.env；测试环境注入假 reader。 */
  readonly readEnv?: TrustOptions["readEnv"]
  /**
   * 二次确认回调。生产环境注入 `requestUserConfirmation`（Tauri dialog）；
   * 测试环境注入 `async () => true/false` 跳过原生 UI。
   *
   * 注入式而非直接 import 的原因：本模块需在 vitest（无 Tauri）下做单测，
   * 让测试用例能直接控制确认结果而无需 mock dynamic import。
   */
  readonly confirmCallback?: (
    packageName: DynamicPackage,
  ) => Promise<boolean>
}

/** `resolveDynamicProvider` 的返回值。 */
export interface ResolvedDynamicProvider {
  readonly sdkInstance: unknown
  readonly protocolID: ProtocolID
  readonly packageName: DynamicPackage
}

// ─── Internal helpers ─────────────────────────────────────────────────

/**
 * 反射 `mod` 的所有导出，找一个名字以 `create` 开头且类型为 function 的
 * 工厂函数。优先匹配名字最长的（`createOpenAICompatible` 优于 `createX`），
 * 这与 opencode dynamic.ts 的启发式一致——长名字往往更具体。
 *
 * 找不到任何工厂时返回 null，由调用方抛 `DynamicProviderNoFactoryError`。
 */
function findFactoryFunction(
  mod: Record<string, unknown>,
): { name: string; fn: (options: unknown) => unknown } | null {
  const candidates = Object.entries(mod)
    .filter(
      (entry): entry is [string, (options: unknown) => unknown] =>
        entry[0].startsWith("create") && typeof entry[1] === "function",
    )
    .sort((a, b) => b[0].length - a[0].length)
  if (candidates.length === 0) return null
  const [name, fn] = candidates[0]!
  return { name, fn }
}

/**
 * 工厂返回值的最小形态校验。要求具备 Vercel AI SDK `LanguageModelV*`
 * 接口的三个必要字段：
 *
 * - `specificationVersion`：`"v1"` / `"v2"` 等协议版本字符串
 * - `provider`：provider 名（用于 telemetry）
 * - `modelId`：模型 ID
 *
 * 任一缺失都视为该工厂返回的不是合法 LanguageModel——返回缺失字段列表，
 * 由调用方抛 `DynamicProviderInvalidFactoryError`。
 */
function validateLanguageModelShape(value: unknown): {
  ok: boolean
  missing: readonly string[]
} {
  const required = ["specificationVersion", "provider", "modelId"] as const
  if (typeof value !== "object" || value === null) {
    return { ok: false, missing: [...required] }
  }
  const obj = value as Record<string, unknown>
  const missing = required.filter((k) => !(k in obj))
  return { ok: missing.length === 0, missing }
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * 解析 dynamic provider，返回 LanguageModel 实例 + 协议 ID。
 *
 * **执行顺序**（任一步失败都立即抛错，不进入下一步）：
 *
 * 1. 白名单校验 — 命中 `DYNAMIC_PACKAGE_WHITELIST` 正则
 * 2. trust 检查 — `checkTrust` 返回 `false` 时调用 `confirmCallback` 二次确认
 *    - 用户拒绝 → `DynamicProviderUserDeclinedError`
 *    - 用户确认 → `markTrusted` 写入信任清单
 * 3. 动态加载 — `await import(packageName)`
 * 4. 反射工厂 — 找 `createXxx` 函数（找不到 → `DynamicProviderNoFactoryError`）
 * 5. 调用工厂 — `factory({ apiKey, baseURL, headers, name })`
 * 6. 形态校验 — 检查 `specificationVersion` / `provider` / `modelId` 三字段
 *
 * @returns `{ sdkInstance: LanguageModel, protocolID: "openai-compatible", packageName }`
 *
 * @throws DynamicProviderMissingPackageError 当 `config.dynamicPackage` 未提供
 * @throws DynamicProviderNotAllowedError 当包名不匹配白名单
 * @throws DynamicProviderUserDeclinedError 当用户在确认对话框中点了取消
 * @throws DynamicProviderNoFactoryError 当包内无任何 `createXxx` 函数
 * @throws DynamicProviderInvalidFactoryError 当工厂返回值缺 LanguageModel 必要字段
 */
export async function resolveDynamicProvider(
  options: ResolveDynamicProviderOptions,
): Promise<ResolvedDynamicProvider> {
  const { config, modelID, workspacePath, readEnv, confirmCallback } = options

  // ── Step 1: dynamicPackage 必填检查 ─────────────────────────────
  if (!config.dynamicPackage) {
    throw new DynamicProviderMissingPackageError({ providerID: "dynamic" })
  }
  const packageName = config.dynamicPackage

  // ── Step 2: 白名单正则匹配 ──────────────────────────────────────
  if (!DYNAMIC_PACKAGE_WHITELIST.test(packageName)) {
    throw new DynamicProviderNotAllowedError({
      packageName,
      reason: `Package name does not match whitelist /^@ai-sdk\\/[a-z0-9-]+$/`,
    })
  }
  // 通过白名单后，TS 仍把 packageName 推断为 string；显式 cast 到 DynamicPackage
  // 模板字面量类型，让后续 trust API 接受。这次 cast 在白名单校验之后是安全的。
  const trustedPackageName = packageName as DynamicPackage

  // ── Step 3: trust 检查 + 必要时二次确认 ─────────────────────────
  const trustOptions: TrustOptions = { workspacePath, readEnv }
  const alreadyTrusted = await checkTrust(trustedPackageName, trustOptions)
  if (!alreadyTrusted) {
    const confirm = confirmCallback ?? requestUserConfirmation
    const userConfirmed = await confirm(trustedPackageName)
    if (!userConfirmed) {
      throw new DynamicProviderUserDeclinedError({
        packageName: trustedPackageName,
      })
    }
    // workspacePath 为 null 时无法持久化——此时跳过 markTrusted
    // （下次启动还会再问一次，但这是 spec 允许的降级行为）
    if (workspacePath !== null) {
      await markTrusted(trustedPackageName, trustOptions)
    }
  }

  // ── Step 4: 动态 import ────────────────────────────────────────
  // 用变量喂 import() 让 Vite 不做静态分析（否则会试图把所有可能的包打入 bundle）。
  // `@vite-ignore` 注释告知 Vite 跳过对该 import 的依赖预构建。
  const mod = (await import(/* @vite-ignore */ trustedPackageName)) as Record<
    string,
    unknown
  >

  // ── Step 5: 反射 createXxx 工厂 ────────────────────────────────
  const factoryEntry = findFactoryFunction(mod)
  if (factoryEntry === null) {
    throw new DynamicProviderNoFactoryError({
      packageName: trustedPackageName,
      availableExports: Object.keys(mod),
    })
  }

  // ── Step 6: 调用工厂构造 LanguageModel ─────────────────────────
  // 大多数 @ai-sdk/* 工厂签名一致：`(options) => (modelID) => LanguageModel`。
  // 但也有少数包工厂直接吐 LanguageModel（无 modelID 二段调用）。
  // 我们采用「先尝试两段、失败回退一段」的启发式——这与 opencode dynamic.ts 一致。
  const baseURL = config.baseURL ?? ""
  const factoryOptions = {
    apiKey: config.apiKey,
    baseURL,
    headers: config.headers,
    // openai-compatible 的 name 字段是必填，dynamic 场景下 fallback 用包名做
    // telemetry 标识；其它工厂无此字段会忽略。
    name: trustedPackageName.replace(/^@ai-sdk\//, ""),
  }
  let sdkInstance: unknown
  const factoryResult = factoryEntry.fn(factoryOptions)
  if (typeof factoryResult === "function") {
    // 两段调用形态：factory(options)(modelID)
    sdkInstance = (factoryResult as (id: string) => unknown)(modelID)
  } else {
    // 一段调用形态：factory(options) 直接返回 LanguageModel
    sdkInstance = factoryResult
  }

  // ── Step 7: 形态校验 ───────────────────────────────────────────
  const shape = validateLanguageModelShape(sdkInstance)
  if (!shape.ok) {
    throw new DynamicProviderInvalidFactoryError({
      packageName: trustedPackageName,
      factoryName: factoryEntry.name,
      missingFields: shape.missing,
    })
  }

  return {
    sdkInstance,
    protocolID: DYNAMIC_PROTOCOL,
    packageName: trustedPackageName,
  }
}

// ─── Fallback 工厂（无 dynamic 包名时复用 createOpenAICompatible） ────

/**
 * 极简 fallback：当用户配置 `providerID === "dynamic"` 但显式给定 `baseURL`
 * 而非 `dynamicPackage` 时，直接返回 `createOpenAICompatible` 实例——不做任何
 * 动态 import 也不触发二次确认。
 *
 * 用例：自托管的某个 OpenAI 兼容服务但用户不想为它写一个具名 plugin。
 *
 * 注意：本函数当前**未**接入 `resolveDynamicProvider` 的流程，保留作为后续
 * Decision 9 的扩展点；MVP 阶段 `providerID === "dynamic"` 必须配 `dynamicPackage`。
 */
export function _experimentalCreateOpenAICompatibleFallback(
  config: ProviderConfig,
  modelID: string,
): unknown {
  const factory = createOpenAICompatible({
    name: "dynamic-fallback",
    apiKey: config.apiKey,
    baseURL: config.baseURL ?? "",
    headers: config.headers,
  })
  return factory(modelID)
}
