import { Effect, Layer, Context } from "effect"
import type {
  ProtocolID,
  PromptStyleID,
  DynamicPackage,
} from "../provider/_types"

// 把类型联合 re-export，便于消费方直接从 config 模块引用
// （不强求；保留 import 路径靠近声明源也可。）
export type { ProtocolID, PromptStyleID, DynamicPackage }

/**
 * Config — Agent Runtime configuration management.
 *
 * Adapted from OpenCode's config system — simplified for HROps:
 * - Removed: File-based config discovery, JSON/JSONC parsing, Schema validation,
 *   Config watchers, Markdown config, Project/Worktree config
 * - Kept: get/set pattern, model/provider config, MCP server config
 * - Uses in-memory config with JSON initialization
 *
 * Usage:
 * ```ts
 * const configLayer = Config.layer({
 *   providers: { openai: { apiKey: "..." }, anthropic: { apiKey: "..." } },
 *   defaultModel: { modelID: "gpt-4o", providerID: "openai" },
 *   mcpServers: { "seven-hrops": { type: "local", command: ["node", "mcp-server.js"] } },
 * })
 * ```
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface ModelConfig {
  modelID: string
  providerID: string
}

export interface ProviderConfig {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  /** Custom model mappings: local name → provider model ID */
  models?: Record<string, string>
  /**
   * 可选：显式指定使用的协议家族 ID。
   *
   * 优先级高于 plugin 默认值。
   * - 内置具名 providerID（如 "openai" / "volcengine"）缺省走 plugin.defaultProtocol；
   * - 未知 providerID 缺省 = undefined 时 registry 抛 UnknownProviderProtocolError。
   *
   * 见 runtime-multimodel-protocol-adapter / specs/agent-runtime-llm-provider/spec.md。
   */
  protocol?: ProtocolID
  /**
   * 可选：显式指定 prompt-style 工具调用装饰器。
   *
   * - undefined：走 plugin.promptStyle（如 volcengine 默认 "doubao"）；
   * - null：显式关闭装饰器（即使 plugin 默认开启也不挂载）；
   * - string：覆盖 plugin 默认。
   *
   * 类型层用 `PromptStyleID | null` 表达"显式关闭"语义。
   */
  promptStyle?: PromptStyleID | null
  /**
   * 可选：仅当 providerID === "dynamic" 时生效，指定要动态加载的 npm 包名。
   *
   * 必须以 `@ai-sdk/` 开头（白名单约束，与 plugins/dynamic.ts 的正则双重锁紧）。
   */
  dynamicPackage?: DynamicPackage
}

export interface AgentRuntimeConfig {
  /** AI providers configuration */
  providers: Record<string, ProviderConfig>
  /** Default model to use */
  defaultModel: ModelConfig
  /** MCP servers to connect */
  mcpServers: Record<string, import("../mcp/index").MCPConfig>
  /** Agent-specific model overrides */
  agentModels?: Record<string, ModelConfig>
  /** Global permission rules */
  permissions?: import("../permission/index").Rule[]
  /** Custom skills (name → skill content) */
  skills?: Record<string, { description?: string; content: string }>
  /** Debug mode */
  debug?: boolean
}

// ─── Service ─────────────────────────────────────────────────────────

export interface Interface {
  readonly get: () => Effect.Effect<AgentRuntimeConfig>
  readonly set: (config: Partial<AgentRuntimeConfig>) => Effect.Effect<void>
  readonly getModel: (agentName?: string) => Effect.Effect<ModelConfig>
  readonly getProvider: (providerID: string) => Effect.Effect<ProviderConfig>
  readonly getMCPServers: () => Effect.Effect<Record<string, import("../mcp/index").MCPConfig>>
}

export class Service extends Context.Service<Service, Interface>()("@agent-runtime/Config") {}

// ─── Implementation ──────────────────────────────────────────────────

const DEFAULT_CONFIG: AgentRuntimeConfig = {
  providers: {},
  defaultModel: { modelID: "qwen3:8b", providerID: "ollama" },
  mcpServers: {},
}

export function layer(initialConfig?: Partial<AgentRuntimeConfig>) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      let config: AgentRuntimeConfig = {
        ...DEFAULT_CONFIG,
        ...initialConfig,
        providers: { ...DEFAULT_CONFIG.providers, ...initialConfig?.providers },
        mcpServers: { ...DEFAULT_CONFIG.mcpServers, ...initialConfig?.mcpServers },
      }

      const get = Effect.fn("Config.get")(function* () {
        return config
      })

      const set = Effect.fn("Config.set")(function* (update: Partial<AgentRuntimeConfig>) {
        config = { ...config, ...update }
      })

      const getModel = Effect.fn("Config.getModel")(function* (agentName?: string) {
        if (agentName && config.agentModels?.[agentName]) {
          const model = config.agentModels[agentName]
          // Verify the provider exists; if not, fall back to default model
          if (!config.providers[model.providerID]) {
            console.warn(`Agent "${agentName}" model provider "${model.providerID}" not found, falling back to default model`)
            return config.defaultModel
          }
          return model
        }
        return config.defaultModel
      })

      const getProvider = Effect.fn("Config.getProvider")(function* (providerID: string) {
        const provider = config.providers[providerID]
        if (!provider) {
          // Fallback: try to use any available provider instead of throwing
          const availableIDs = Object.keys(config.providers)
          if (availableIDs.length > 0) {
            const fallbackID = availableIDs[0]
            console.warn(`Provider "${providerID}" not found, falling back to "${fallbackID}"`)
            return config.providers[fallbackID]
          }
          throw new Error(`Provider "${providerID}" not found in config and no fallback available`)
        }
        return provider
      })

      const getMCPServers = Effect.fn("Config.getMCPServers")(function* () {
        return config.mcpServers
      })

      return Service.of({ get, set, getModel, getProvider, getMCPServers })
    }),
  )
}

export const defaultLayer = layer()

export const Config = { Service, defaultLayer, layer }
