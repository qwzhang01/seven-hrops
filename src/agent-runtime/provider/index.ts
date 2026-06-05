/**
 * Provider — AI model provider 集成入口（Service 层壳 + createAdapter 实现）。
 *
 * 本文件是 [`ProviderRegistry`](./registry.ts) 的对外 Service 包装层，提供：
 *
 * - `Provider.Service` —— Effect Layer 形态的 AI provider service（Service 层
 *   入口，[`Session`](../session/session.ts) 等业务层依赖此 Service）；
 * - `createAdapter()` —— 把 `(providerID, config, modelID)` 转换为 `ModelAdapter`，
 *   现在内部统一走 [`defaultProviderRegistry.resolve()`](./registry.ts) 路径。
 *
 * ## 重构里程碑（runtime-multimodel-protocol-adapter 阶段 10）
 *
 * 此前本文件是一个 ~380 行的"内部全集"——在同一个文件里塞了 SDK 工厂 switch、
 * stream 转换、message 转换、tool 转换、JSON Schema → Zod。阶段 10 把所有
 * 重复实现**删干净**，改为：
 *
 * | 关注点                                    | 现在的归属 |
 * |-------------------------------------------|------------|
 * | 19 个 provider 的 SDK 工厂                | [`plugins/*`](./plugins) 19 个薄壳 |
 * | dynamic provider 白名单 + 二次确认 + 反射 | [`plugins/dynamic.ts`](./plugins/dynamic.ts) |
 * | 协议形态归一化（OpenAI / Compatible / Anthropic） | [`protocols/*`](./protocols) 3 个 adapter |
 * | prompt-style tool-call 跨 chunk 解析       | [`protocols/prompt-style-tool-call.ts`](./protocols/prompt-style-tool-call.ts) |
 * | message / tool / schema 通用转换           | [`protocols/_shared.ts`](./protocols/_shared.ts) |
 * | (providerID, config) → (sdkInstance, adapter) 路由 | [`registry.ts`](./registry.ts) |
 *
 * 本文件**只剩**两件事：
 *
 * 1. 把 `registry.resolve()` 解析出的 `(sdkInstance, adapter)` 与 `streamText`
 *    黏起来——`streamText` 调用必须显式 `stopWhen: aiStepCountIs(1)`，避免 SDK
 *    进入 agent loop（详见 arch-runtime-single-loop）。
 * 2. 暴露 Effect Layer 形态的 `Provider.Service`，让上层无感切换。
 *
 * **不向后兼容**：阶段 10 起：
 *
 * - 旧的 `switch (providerID) { case "openai" / "anthropic" / "ollama" / default }`
 *   分支彻底**删除**——19 个具名 plugin 已覆盖所有原始 case，外加 dynamic 兜底。
 * - 旧的 `convertToAiSdkTools`（带 `execute` 的版本）彻底**删除**——保留它会让
 *   AI SDK 再次进入 agent loop，违反 single-loop 契约（参 arch-runtime-single-loop）。
 *   single-loop 测试已守卫此不变量。
 * - **不引入** `USE_LEGACY_PROVIDER_SWITCH` 等回滚开关——架构切换应一刀切，
 *   保留兼容层只会让两条路径并存腐烂。
 *
 * ## 单一 agent loop 不变量（arch-runtime-single-loop）
 *
 * - 工具 dispatch 由 [`ToolRuntime`](../agent/tool-runtime.ts) 独占，本文件
 *   SHALL NOT 给 SDK 传 `execute`；
 * - `streamText` SHALL 显式 `stopWhen: aiStepCountIs(1)`；
 * - 遗漏任一点都会造成 deadlock 或 double-dispatch。
 */

import { Effect, Layer, Context, Stream } from "effect"
import {
  streamText,
  stepCountIs as aiStepCountIs,
  type LanguageModel as AiLanguageModel,
} from "ai"
import type { ModelAdapter } from "../agent/tool-runtime"
import { Config, type ProviderConfig, type ModelConfig } from "../config/index"
import { defaultProviderRegistry } from "./registry"
import {
  convertToAiSdkMessages,
  convertToAiSdkToolsForDeclarationOnly,
  flattenToolMessagesForPromptStyle,
} from "./protocols/_shared"
import { ProtocolAdapters, withPromptStyleToolCall } from "./protocols/index"
import { ProviderPlugins, BUILT_IN_PROVIDER_IDS } from "./plugins/index"

// ─── Types ───────────────────────────────────────────────────────────

export interface ProviderInfo {
  id: string
  name: string
  type: "openai" | "anthropic" | "ollama" | "custom"
}

// ─── Service ─────────────────────────────────────────────────────────

export interface Interface {
  readonly createModelAdapter: (
    modelConfig: ModelConfig,
  ) => Effect.Effect<ModelAdapter, Error>
  readonly listProviders: () => Effect.Effect<ProviderInfo[]>
  readonly getDefaultAdapter: () => Effect.Effect<ModelAdapter, Error>
}

export class Service extends Context.Service<Service, Interface>()(
  "@agent-runtime/Provider",
) {}

// ─── createAdapter（核心切换点） ─────────────────────────────────────

/**
 * 把 `(providerID, config, modelID)` 解析为 `ModelAdapter`。
 *
 * 算法（**唯一路径**，无 legacy switch）：
 *
 * 1. 调用 [`defaultProviderRegistry.resolve()`](./registry.ts) 拿到
 *    `{ sdkInstance, adapter }`——这一步统一处理 19 个具名 plugin + dynamic
 *    分支 + 未知 providerID 显式 protocol 兜底 + fail-fast 三种情况。
 * 2. 闭包返回 `ModelAdapter.stream(options)`：内部用 `streamText({ model:
 *    sdkInstance, ..., stopWhen: stepCountIs(1) })` 拉 raw stream，再交给
 *    `adapter.transform()` 归一化为 `Stream<LLMStreamEvent, Error>`。
 *
 * **异步性**：`registry.resolve` 是 async（dynamic 分支需要 `await import()`），
 * 所以 `createAdapter` 也是 async；上层 `Layer.effect` 用 `Effect.tryPromise`
 * 把它桥接回 Effect 的同步 ModelAdapter 接口。
 *
 * @returns ModelAdapter —— 仅做 raw LLM streaming，agent loop 由 ToolRuntime 持有。
 */
async function createAdapter(
  providerID: string,
  providerConfig: ProviderConfig,
  modelID: string,
): Promise<ModelAdapter> {
  // 解析 modelID：providerConfig.models 别名（例：claude-3-haiku → claude-3-haiku-20240307）
  const resolvedModelID = providerConfig.models?.[modelID] ?? modelID

  // ── 唯一解析入口：registry.resolve ────────────────────────────────
  // 失败时（UnknownProviderProtocolError / DynamicProviderXxxError 等）让异常
  // 自然向上抛——上层 `Layer.effect` 的 `Effect.tryPromise` 会把它转成 Effect
  // 的 fail channel，由调用方决定是显示给用户还是降级。
  const resolved = await defaultProviderRegistry.resolve(
    providerID,
    providerConfig,
    resolvedModelID,
  )

  return {
    stream: (options) => {
      // INVARIANT (arch-runtime-single-loop):
      //   Provider 是单步的 raw LLM stream，agent loop 由 ToolRuntime 独占。
      //   - 不传 `execute` 给 AI SDK，避免 SDK 自行执行工具（双重调度）。
      //   - 显式传 `stopWhen: stepCountIs(1)`，声明意图。
      //   遗漏任一点都会造成 deadlock 或 double-dispatch。
      const aiSdkTools = convertToAiSdkToolsForDeclarationOnly(options.tools)

      const streamPromise = async () => {

        console.debug("\n========== LLM Request ==========")
        console.debug("Model:", (resolved.sdkInstance as { modelId?: string }).modelId ?? modelID)
        console.debug("System Prompt:", options.systemPrompt)
        console.debug("Messages:", JSON.stringify(options.messages, null, 2))
        console.debug("Tools (declaration only):", JSON.stringify(
          options.tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })),
          null, 2
        ))
        console.debug("Temperature:", options.temperature)
        console.debug("================================\n")

        // prompt-style models (doubao/qwen) do not support native function-calling
        // message schema. When follow-up messages contain tool-call/tool-result
        // ContentParts, we must flatten them to plain text before sending to the LLM.
        const processedMessages = resolved.promptStyle
          ? flattenToolMessagesForPromptStyle(options.messages)
          : options.messages

        const result = streamText({
          model: resolved.sdkInstance as AiLanguageModel,
          system: options.systemPrompt,
          messages: convertToAiSdkMessages(processedMessages),
          tools: aiSdkTools,
          // single-step: agent loop owned by ToolRuntime, see arch-runtime-single-loop
          stopWhen: aiStepCountIs(1),
          temperature: options.temperature,
        })
        return result.fullStream
      }

      return Stream.unwrap(
        Effect.tryPromise({
          try: streamPromise,
          catch: (err) => (err instanceof Error ? err : new Error(String(err))),
        }).pipe(
          // adapter.transform 接收 raw TextStreamPart async iterable，输出 LLMStreamEvent 流
          Effect.map((aiStream) => {
            
            const loggedStream = {
              [Symbol.asyncIterator]: async function* () {
                const iter = aiStream[Symbol.asyncIterator]()
                while (true) {
                  const { value, done } = await iter.next()
                  if (done) break
                    console.debug("\n---------- LLM Raw Event ----------")
                    console.debug(JSON.stringify(value, null, 2))
                    console.debug("-----------------------------------\n")
                  yield value
                }
              }
            } as AsyncIterable<import("ai").TextStreamPart<Record<string, never>>>
  
            
           return resolved.adapter.transform(
              // streamText().fullStream 的事件类型是 TextStreamPart<TOOLS>，但
              // ProtocolAdapter.transform 用 TextStreamPart<Record<string, never>>
              // 的窄类型——运行时形态等价，仅类型签名差异。
              aiStream as unknown as AsyncIterable<
                import("ai").TextStreamPart<Record<string, never>>
              >,
            )

          }
          ),
        ),
      )
    },
  }
}

// ─── Layer ───────────────────────────────────────────────────────────

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const configService = yield* Config.Service

    const createModelAdapter = (modelConfig: ModelConfig) =>
      Effect.gen(function* () {
        const providerConfig = yield* configService.getProvider(
          modelConfig.providerID,
        )
        // registry.resolve 是 async（dynamic 分支需要 await import）；
        // 用 tryPromise 桥接回 Effect 的同步 ModelAdapter 接口。
        return yield* Effect.tryPromise({
          try: () =>
            createAdapter(
              modelConfig.providerID,
              providerConfig,
              modelConfig.modelID,
            ),
          catch: (err) =>
            err instanceof Error ? err : new Error(String(err)),
        })
      })

    const listProviders = () =>
      Effect.gen(function* () {
        const config = yield* configService.get()
        return Object.entries(config.providers).map(([id]) => ({
          id,
          name: id.charAt(0).toUpperCase() + id.slice(1),
          type: id as ProviderInfo["type"],
        }))
      })

    const getDefaultAdapter = () =>
      Effect.gen(function* () {
        const modelConfig = yield* configService.getModel()
        return yield* createModelAdapter(modelConfig)
      })

    return Service.of({ createModelAdapter, listProviders, getDefaultAdapter })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export const Provider = { Service, defaultLayer, layer }

// ─── __internal —— 测试钩子 ───────────────────────────────────────────

/**
 * 仅供测试使用的内部钩子。
 *
 * - `convertToAiSdkToolsForDeclarationOnly`：[`single-loop.test.ts`](./single-loop.test.ts)
 *   用于守卫 single-loop 不变量——验证返回值绝不含 `execute` 字段。
 * - `registry`：默认 ProviderRegistry 单例，让集成测试可以直接 inject mock
 *   plugin 数组（暂时不开放——见 [`registry.ts`](./registry.ts) 注释）。
 * - `protocols.{Native,Compatible,Anthropic,PromptStyle}`：3 个具名 ProtocolAdapter
 *   + prompt-style 装饰器工厂，让阶段 11 的集成测试能直接拼装最小验证链路而
 *   不必走完整 Service 层。
 * - `plugins`：19 个 ProviderPlugin 数组 + 已知 ID 列表，用于阶段 8 的 plugin
 *   形态契约测试。
 */
export const __internal = {
  convertToAiSdkToolsForDeclarationOnly,
  registry: defaultProviderRegistry,
  protocols: {
    Native: ProtocolAdapters["openai-native"],
    Compatible: ProtocolAdapters["openai-compatible"],
    Anthropic: ProtocolAdapters["anthropic-messages"],
    PromptStyle: withPromptStyleToolCall,
  },
  plugins: {
    list: ProviderPlugins,
    knownIDs: BUILT_IN_PROVIDER_IDS,
  },
}