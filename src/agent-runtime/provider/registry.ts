/**
 * Provider 适配层 — `ProviderRegistry`
 *
 * 协议适配层的**唯一解析入口**。把 `(providerID, config, modelID)` 拼装成
 * `ResolvedProvider = { sdkInstance, adapter }`，是连接 19 个具名 plugin +
 * 1 个 dynamic 分支 + 3 个 ProtocolAdapter + 2 个 prompt-style 装饰器的路由中枢。
 *
 * ## 解析路径
 *
 * ```
 * resolve(providerID, config, modelID, options?)
 *  ├─ if providerID === "dynamic":
 *  │   └─ resolveDynamicProvider({ config, modelID, workspacePath, readEnv, confirmCallback })
 *  │       (走 plugins/dynamic.ts 的 7 步流程：白名单 → trust → import → 反射 → 校验)
 *  │       protocolID 固定 "openai-compatible"
 *  │
 *  ├─ else if 19 个具名 plugin 命中:
 *  │   ├─ sdkInstance = plugin.createSdk({ apiKey, baseURL, headers, modelID })
 *  │   ├─ protocolID = config.protocol ?? plugin.defaultProtocol
 *  │   └─ promptStyle = (config.promptStyle === undefined)
 *  │                    ? plugin.promptStyle               // 走 plugin 默认（如 volcengine → "doubao"）
 *  │                    : config.promptStyle               // 用户覆盖（含 null = 显式关闭）
 *  │
 *  ├─ else if config.protocol 非空（未知 providerID + 显式协议）:
 *  │   └─ 用 createOpenAICompatible 兜底当作自托管 OpenAI 兼容服务（spec Step 2）
 *  │       protocolID = config.protocol
 *  │
 *  └─ else:
 *      └─ throw UnknownProviderProtocolError（含 providerID + 19 个已知 ID 列表）
 * ```
 *
 * 拿到 protocolID + promptStyle 后：
 *
 * ```
 * baseAdapter = ProtocolAdapters[protocolID]
 * adapter = (promptStyle != null)
 *           ? withPromptStyleToolCall(baseAdapter, promptStyle)
 *           : baseAdapter
 * ```
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * Registry **不**持有 ToolRuntime 引用、**不**实现 agent loop。它只做"配置 →
 * (SDK 实例, ProtocolAdapter)"的纯解析；调用方（agent-runtime/provider/index.ts）
 * 拿到结果后用于 `streamText({ model: sdkInstance, ... })`。
 *
 * ## 跨层契约纪律
 *
 * - **禁止隐式默认值**：未知 providerID + 缺 protocol 时 fail-fast 抛
 *   `UnknownProviderProtocolError`——SHALL NOT 静默回退到 OpenAI 协议（这就是
 *   本 change 治本对象，参 design.md 治标方案 A 的反例）。
 * - **跨层枚举经过 resolver**：本模块即 `providerID` 的 resolver；Service /
 *   Component 层 SHALL NOT 绕过 registry 直接 import plugin 数组。
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import {
  UnknownProviderProtocolError,
  type ProtocolAdapter,
  type ProtocolID,
  type PromptStyleID,
  type ProviderRegistry,
  type ResolveOptions,
  type ResolvedProvider,
} from "./_types"
import type { ProviderConfig } from "../config/index"
import {
  BUILT_IN_PROVIDER_IDS,
  ProviderPlugins,
  resolveDynamicProvider,
  type ProviderPlugin,
} from "./plugins/index"
import {
  ProtocolAdapters,
  withPromptStyleToolCall,
} from "./protocols/index"

// ─── 内部纯函数 ───────────────────────────────────────────────────────

/**
 * 根据 protocolID + promptStyle 选择最终的 ProtocolAdapter。
 *
 * 单独抽出便于阶段 7/8 的 vitest 单测——给定 (protocolID, promptStyle) 二元组
 * 验证返回的 adapter 是裸 base 还是装饰器形态。
 */
export function selectAdapter(
  protocolID: ProtocolID,
  promptStyle: PromptStyleID | null | undefined,
): ProtocolAdapter {
  const base = ProtocolAdapters[protocolID]
  // promptStyle 三态语义：
  //   undefined → 在调用方已经合成为 "走 plugin 默认或 null"，到这里只剩 string|null
  //   null      → 显式关闭，不挂装饰器
  //   "doubao" / "qwen" → 挂装饰器
  if (promptStyle === null || promptStyle === undefined) {
    return base
  }
  return withPromptStyleToolCall(base, promptStyle)
}

/**
 * 在 19 个具名 plugin 中按 ID 查找。线性 find 而非 Map 索引——19 项的常量数组
 * find 速度足够，且 plugins/index.ts 把 plugin 数组定义为 readonly 常量便于
 * 类型推断不破。
 */
function findPluginByID(providerID: string): ProviderPlugin | undefined {
  return ProviderPlugins.find((p) => p.id === providerID)
}

/**
 * 合并三态 promptStyle 决策：
 *   - config.promptStyle === undefined → 走 plugin 默认（可能是 undefined）
 *   - config.promptStyle === null      → 显式关闭，返回 null
 *   - config.promptStyle 是字符串       → 覆盖默认
 *
 * 返回 `null | PromptStyleID | undefined`，由 selectAdapter 处理。
 */
function resolvePromptStyle(
  config: ProviderConfig,
  pluginDefault: PromptStyleID | undefined,
): PromptStyleID | null | undefined {
  if (config.promptStyle === undefined) {
    return pluginDefault
  }
  return config.promptStyle
}

// ─── 公共 API ────────────────────────────────────────────────────────

/**
 * 创建一个 ProviderRegistry 实例。当前实现是无状态的纯函数包装，工厂函数留作
 * 未来扩展点（例如未来引入注册自定义 plugin 的入口、或注入 mock 用于测试）。
 */
export function createProviderRegistry(): ProviderRegistry {
  return {
    resolve: async (
      providerID: string,
      config: ProviderConfig,
      modelID: string,
      options?: ResolveOptions,
    ): Promise<ResolvedProvider> => {
      // ── 分支 1：dynamic provider ─────────────────────────────────
      if (providerID === "dynamic") {
        const result = await resolveDynamicProvider({
          config,
          modelID,
          workspacePath: options?.workspacePath ?? null,
          readEnv: options?.readEnv,
          confirmCallback: options?.confirmCallback,
        })
        // dynamic 路径 promptStyle 仍尊重用户配置：null = 显式关闭、
        // string = 套装饰器、undefined = 不挂（dynamic 没 plugin 默认）
        const resolvedPromptStyle = config.promptStyle ?? null
        const adapter = selectAdapter(
          result.protocolID,
          resolvedPromptStyle,
        )
        return { sdkInstance: result.sdkInstance, adapter, promptStyle: resolvedPromptStyle }
      }

      // ── 分支 2：19 个具名 plugin ─────────────────────────────────
      const plugin = findPluginByID(providerID)
      if (plugin !== undefined) {
        const baseURL = config.baseURL ?? plugin.defaultBaseURL
        const sdkInstance = plugin.createSdk({
          apiKey: config.apiKey,
          baseURL,
          headers: config.headers,
          modelID,
        })
        const protocolID: ProtocolID =
          config.protocol ?? plugin.defaultProtocol
        const promptStyle = resolvePromptStyle(config, plugin.promptStyle)
        const adapter = selectAdapter(protocolID, promptStyle)
        return { sdkInstance, adapter, promptStyle: promptStyle ?? null }
      }

      // ── 分支 3：未知 providerID + 显式 protocol → OpenAI-Compatible 兜底
      // spec.md Step 2 「若 config.protocol 非空：使用之」——典型场景是
      // 自托管的 vLLM / LM Studio / TGI 等服务，用户填了任意 providerID 但
      // 显式声明 protocol = "openai-compatible"。
      if (config.protocol !== undefined) {
        const baseURL = config.baseURL ?? ""
        const factory = createOpenAICompatible({
          name: providerID,
          apiKey: config.apiKey,
          baseURL,
          headers: config.headers,
        })
        const sdkInstance = factory(modelID)
        const resolvedPromptStyle = config.promptStyle ?? null
        const adapter = selectAdapter(
          config.protocol,
          // 未知 provider 没 plugin 默认 promptStyle 可走，只取用户显式配置
          resolvedPromptStyle,
        )
        return { sdkInstance, adapter, promptStyle: resolvedPromptStyle }
      }

      // ── 分支 4：未知 providerID + 缺 protocol → fail-fast ────────
      // 这是整个 change 的治本核心——禁止隐式默认值（跨层契约纪律 1）。
      // 错误消息含 19 个已知 ID 列表，指引用户要么改 ID 要么加 protocol。
      throw new UnknownProviderProtocolError({
        providerID,
        knownProviderIDs: BUILT_IN_PROVIDER_IDS,
      })
    },
  }
}

/**
 * 默认单例 ProviderRegistry。业务层调用方（agent-runtime/provider/index.ts、
 * Service 层、testing helpers）SHALL 仅从这里取 registry，不要每次调用 resolve
 * 时都重新 createProviderRegistry()。
 *
 * 单例无状态——本身只是一组纯函数闭包；多份实例并不会带来语义差异，但保留
 * 单例便于未来若引入 plugin 动态注册时让所有调用方共享同一注册表。
 */
export const defaultProviderRegistry: ProviderRegistry = createProviderRegistry()

// ─── 公共 re-export ──────────────────────────────────────────────────

export type {
  ProviderRegistry,
  ResolvedProvider,
  ResolveOptions,
  ProtocolID,
  PromptStyleID,
}
