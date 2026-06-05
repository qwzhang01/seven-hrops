/**
 * Platform runtime configuration helpers.
 *
 * Two responsibilities:
 *   1. `loadRuntimeConfig(modelConfig)` — turns the user's persisted
 *      `AIModelConfig` plus the static `agent-runtime-config.json` into the
 *      shape `createAppLayer` expects (`AgentRuntimeConfig`).
 *      Provider aliasing (anthropic → claude) and agent-model fallback when
 *      an API key is missing are handled here.
 *   2. `registerEmbeddedMCPServer(runtime)` — best-effort registration of
 *      the in-process MCP server. Failure (e.g. no DB in browser dev mode)
 *      is logged as a warning instead of aborting bootstrap.
 *
 * This module is the single home for runtime-assembly knowledge that used
 * to live inside `aiStore.initializeRuntime`.
 */

import { Effect } from "effect"

import type { AgentRuntimeConfig, ModelConfig, ProviderConfig } from "@/agent-runtime/config"
import type { AIModelConfig } from "@/stores/aiStore"

import baseConfig from "@/agent-runtime-config.json"
import type { PlatformRuntime } from "./bootstrap"
import { toolRegistry } from "./registry/toolRegistry"
import { registerAllToolpacks } from "@/tool-registry"

// ─── Types ───────────────────────────────────────────────────────────

interface RawAgentEntry {
  model?: { providerID: string; modelID: string }
}

interface RawConfig {
  agent?: Record<string, RawAgentEntry>
  provider?: Record<string, { apiKey?: string; baseURL?: string }>
  model?: { default?: { providerID: string; modelID: string } }
}

const RAW_CONFIG = baseConfig as RawConfig

/**
 * Provider id mapping between the static config file (`anthropic`) and the
 * UI / store convention (`claude`). Both are accepted on the input side and
 * registered on the output side so adapter lookup never fails.
 */
const PROVIDER_ALIASES: Record<string, string> = {
  anthropic: "claude",
}

/** Providers that don't require an API key — used for fallback gating. */
const PROVIDERS_WITHOUT_API_KEY = new Set(["ollama"])

// ─── Feature Flags ───────────────────────────────────────────────────

/**
 * Phase F: Platform feature flags.
 * These control whether certain capabilities are exposed to the UI.
 * Model paths and binary management remain in Rust (models.rs).
 */
export interface PlatformFeatures {
  /** Whether audio transcription capability is exposed to UI. Default: true. */
  readonly transcribe: boolean
}

export const defaultFeatures: PlatformFeatures = Object.freeze({
  transcribe: true,
})

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Build the full `AgentRuntimeConfig` consumed by
 * `createAppLayer(config)`.
 *
 * Inputs:
 * - `modelConfig`: the user's currently selected provider/model with their
 *   API key and base URL.
 * - `RAW_CONFIG`: bundled `agent-runtime-config.json` shipped with the app,
 *   containing default agent → model assignments.
 *
 * Output rules:
 * - All providers from RAW_CONFIG are registered. If a provider id has an
 *   alias (anthropic → claude) BOTH ids point to the same `ProviderConfig`,
 *   so adapter lookup works regardless of which id callers use.
 * - The user-selected provider's entry is overridden with the user's
 *   API key + base URL (so changes in Settings actually take effect).
 * - Each agent in RAW_CONFIG.agent.* gets an entry in `agentModels`. If the
 *   agent's provider needs an API key but none is configured, that agent
 *   falls back to the user's currently selected provider/model so it still
 *   produces output (developers without a Claude key should still be able
 *   to test the screener locally with Ollama).
 * - `defaultModel` always reflects the user's explicit selection.
 */
export function loadRuntimeConfig(modelConfig: AIModelConfig): AgentRuntimeConfig {
  const providers: Record<string, ProviderConfig> = {}
  const agentModels: Record<string, ModelConfig> = {}

  // 1. Register every provider from the static config, preserving aliases
  //    so the same ProviderConfig is reachable under both ids.
  if (RAW_CONFIG.provider) {
    for (const [id, cfg] of Object.entries(RAW_CONFIG.provider)) {
      const resolvedID = PROVIDER_ALIASES[id] ?? id
      const providerCfg: ProviderConfig = {
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL,
      }
      providers[resolvedID] = providerCfg
      if (resolvedID !== id) {
        providers[id] = providerCfg
      }
    }
  }

  // 2. Override the user-selected provider with the latest user values.
  providers[modelConfig.providerID] = {
    apiKey: modelConfig.apiKey,
    baseURL: modelConfig.baseURL,
  }

  // 3. Build per-agent model overrides with API-key fallback.
  if (RAW_CONFIG.agent) {
    for (const [name, agent] of Object.entries(RAW_CONFIG.agent)) {
      if (!agent.model) continue

      // Resolve the alias once so downstream lookups use the canonical id.
      let agentProviderID = agent.model.providerID
      const aliasTarget = PROVIDER_ALIASES[agentProviderID]
      if (aliasTarget) {
        agentProviderID = aliasTarget
      }

      const agentProvider = providers[agentProviderID]
      const needsApiKey = !PROVIDERS_WITHOUT_API_KEY.has(agentProviderID)
      const hasApiKey = !!agentProvider?.apiKey

      if (needsApiKey && !hasApiKey) {
        // Fallback so the agent is still runnable in dev environments where
        // a Claude/OpenAI key is not configured.
        // eslint-disable-next-line no-console
        console.warn(
          `[platform/runtimeConfig] Agent "${name}" uses provider "${agent.model.providerID}" ` +
            `which has no API key. Falling back to user's provider "${modelConfig.providerID}".`,
        )
        agentModels[name] = {
          providerID: modelConfig.providerID,
          modelID: modelConfig.modelID,
        }
      } else {
        agentModels[name] = {
          providerID: agentProviderID,
          modelID: agent.model.modelID,
        }
      }
    }
  }

  // 4. Default model always tracks the user's choice. Ensure that
  //    provider has at least an entry so adapter lookup never throws.
  const defaultModel: ModelConfig = {
    providerID: modelConfig.providerID,
    modelID: modelConfig.modelID,
  }
  if (!providers[defaultModel.providerID]) {
    providers[defaultModel.providerID] = {
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseURL,
    }
  }

  return {
    providers,
    defaultModel,
    agentModels: Object.keys(agentModels).length > 0 ? agentModels : undefined,
    mcpServers: {},
  }
}

/**
 * Register the platform toolpacks (fs / parse / webserver / export / system
 * / builder) into `toolRegistry`. Idempotent across `bootstrapPlatform` and
 * `reload` calls — the registry is process-wide singleton, so once Phase B
 * boots its 18 tools, subsequent reloads are no-ops.
 *
 * The function name (`registerEmbeddedMCPServer`) is kept for callsite
 * stability; "MCP server" here means the Phase B in-process tool dispatcher
 * (no stdio child process anymore).
 */
let toolpacksRegistered = false

export async function registerEmbeddedMCPServer(
  _runtime: PlatformRuntime,
): Promise<boolean> {
  if (toolpacksRegistered) return true
  try {
    registerAllToolpacks(toolRegistry, { skipBuilder: import.meta.env.PROD })
    toolpacksRegistered = true
    return true
  } catch (err) {
    // Hard-fail: a bootstrap-time failure here means the entire platform
    // can't see any tools, so log loudly. Caller still treats the rejection
    // as non-fatal (matches existing best-effort contract).
    // eslint-disable-next-line no-console
    console.error("[platform/runtimeConfig] toolpack registration failed:", err)
    return false
  }
}

/** Test-only: reset the idempotency flag so a fresh bootstrap can re-register. */
export function resetToolpackRegistrationForTest(): void {
  toolpacksRegistered = false
}

// `Effect` import retained for potential future helpers; eslint-friendly noop
// to make the import non-removable when treeshaken in dev.
void Effect
