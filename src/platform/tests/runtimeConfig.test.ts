/**
 * Unit tests for `loadRuntimeConfig`.
 *
 * Covers:
 *  - Ollama user gets baseURL applied to the runtime config.
 *  - Provider ids are canonical only — there is no `anthropic → claude`
 *    alias layer anymore (removed in
 *    `runtime-multimodel-protocol-adapter` phase 12.0).
 *  - Agent models referencing a provider without API key fall back to the
 *    user's currently selected provider.
 *  - `defaultModel` always reflects the user's choice.
 */

import { describe, it, expect } from "vitest"
import { loadRuntimeConfig } from "../runtimeConfig"

describe("loadRuntimeConfig", () => {
  it("applies user's baseURL to the ollama provider", () => {
    const cfg = loadRuntimeConfig({
      providerID: "ollama",
      modelID: "qwen3:8b",
      baseURL: "http://example.local:11434",
    })

    expect(cfg.providers.ollama).toBeDefined()
    expect(cfg.providers.ollama.baseURL).toBe("http://example.local:11434")
    expect(cfg.defaultModel).toEqual({
      providerID: "ollama",
      modelID: "qwen3:8b",
    })
  })

  it("registers providers under canonical ids only (no alias rewriting)", () => {
    const cfg = loadRuntimeConfig({
      providerID: "ollama",
      modelID: "qwen3:8b",
      baseURL: "http://localhost:11434",
    })

    // Bundled agent-runtime-config.json declares `anthropic` for the
    // screener / compliance agents. After phase 12.0 there is no alias
    // layer: `anthropic` is the canonical id and the legacy `claude` id
    // is intentionally NOT present.
    expect(cfg.providers.anthropic).toBeDefined()
    expect(cfg.providers.claude).toBeUndefined()
  })

  it("agent without API key falls back to user's provider", () => {
    // User uses ollama; the bundled config maps the screener agent to
    // anthropic, which has no apiKey configured. Fallback should kick in.
    const cfg = loadRuntimeConfig({
      providerID: "ollama",
      modelID: "qwen3:8b",
      baseURL: "http://localhost:11434",
    })

    expect(cfg.agentModels?.screener).toEqual({
      providerID: "ollama",
      modelID: "qwen3:8b",
    })
    expect(cfg.agentModels?.compliance).toEqual({
      providerID: "ollama",
      modelID: "qwen3:8b",
    })
  })

  it("agent uses configured provider when user has provided an API key for it", () => {
    const cfg = loadRuntimeConfig({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      apiKey: "sk-real-key",
    })

    // When user is on anthropic and provides a key, the screener should
    // now run on anthropic rather than fall back.
    expect(cfg.agentModels?.screener?.providerID).toBe("anthropic")
    expect(cfg.agentModels?.screener?.modelID).toBe(
      "claude-sonnet-4-20250514",
    )
  })

  it("defaultModel always reflects user's explicit selection", () => {
    const cfg = loadRuntimeConfig({
      providerID: "anthropic",
      modelID: "claude-haiku-4",
      apiKey: "sk-x",
    })
    expect(cfg.defaultModel).toEqual({
      providerID: "anthropic",
      modelID: "claude-haiku-4",
    })
  })

  it("user-selected provider's apiKey/baseURL override bundled config", () => {
    const cfg = loadRuntimeConfig({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
      apiKey: "sk-user-supplied",
    })
    expect(cfg.providers.anthropic.apiKey).toBe("sk-user-supplied")
  })
})
