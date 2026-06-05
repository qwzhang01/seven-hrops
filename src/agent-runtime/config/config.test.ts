/**
 * Tests for the Config module.
 *
 * Covers: get, set, getModel, getProvider, getMCPServers, default values, layer initialization
 */

import { describe, it, expect } from "vitest"
import { Effect, ManagedRuntime } from "effect"
import { Config, type AgentRuntimeConfig } from "../config/index"

// ─── Default config tests ────────────────────────────────────────────

describe("Config — default layer", () => {
  const rt = ManagedRuntime.make(Config.defaultLayer)

  it("returns default config with the in-code default model (qwen3:8b @ ollama)", async () => {
    const config = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )
    expect(config.defaultModel.modelID).toBe("qwen3:8b")
    expect(config.defaultModel.providerID).toBe("ollama")
  })

  it("returns empty providers by default", async () => {
    const config = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )
    expect(config.providers).toEqual({})
  })

  it("returns empty MCP servers by default", async () => {
    const servers = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.getMCPServers()
      }),
    )
    expect(servers).toEqual({})
  })

  it("getModel returns default model when no agent specified", async () => {
    const model = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.getModel()
      }),
    )
    expect(model.modelID).toBe("qwen3:8b")
    expect(model.providerID).toBe("ollama")
  })

  it("getProvider throws for unknown provider", async () => {
    await expect(
      rt.runPromise(
        Effect.gen(function* () {
          const service = yield* Config.Service
          yield* service.getProvider("nonexistent")
        }),
      ),
    ).rejects.toThrow("Provider \"nonexistent\" not found")
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

// ─── Custom config tests ─────────────────────────────────────────────

describe("Config — custom layer", () => {
  const customConfig: Partial<AgentRuntimeConfig> = {
    providers: {
      openai: { apiKey: "sk-test-123" },
      anthropic: { apiKey: "ant-test-456" },
    },
    defaultModel: { modelID: "claude-3.5-sonnet", providerID: "anthropic" },
    mcpServers: {
      "test-server": {
        type: "local",
        command: ["node", "server.js"],
      },
    },
    agentModels: {
      screener: { modelID: "gpt-4o-mini", providerID: "openai" },
    },
    debug: true,
  }

  const customLayer = Config.layer(customConfig)
  const rt = ManagedRuntime.make(customLayer)

  it("merges custom config with defaults", async () => {
    const config = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )
    expect(config.defaultModel.modelID).toBe("claude-3.5-sonnet")
    expect(config.providers.openai?.apiKey).toBe("sk-test-123")
    expect(config.debug).toBe(true)
  })

  it("returns agent-specific model override", async () => {
    const model = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.getModel("screener")
      }),
    )
    expect(model.modelID).toBe("gpt-4o-mini")
    expect(model.providerID).toBe("openai")
  })

  it("falls back to default model for unknown agent", async () => {
    const model = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.getModel("unknown")
      }),
    )
    expect(model.modelID).toBe("claude-3.5-sonnet")
  })

  it("returns provider config", async () => {
    const provider = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.getProvider("openai")
      }),
    )
    expect(provider.apiKey).toBe("sk-test-123")
  })

  it("returns MCP servers", async () => {
    const servers = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.getMCPServers()
      }),
    )
    expect(servers["test-server"]).toBeDefined()
    expect(servers["test-server"].type).toBe("local")
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

// ─── Config set tests ────────────────────────────────────────────────

describe("Config — set (mutation)", () => {
  const rt = ManagedRuntime.make(Config.defaultLayer)

  it("updates config via set", async () => {
    await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        yield* service.set({
          providers: { ollama: { baseURL: "http://localhost:11434" } },
          defaultModel: { modelID: "llama3", providerID: "ollama" },
        })
      }),
    )

    const config = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Config.Service
        return yield* service.get()
      }),
    )
    expect(config.defaultModel.modelID).toBe("llama3")
    expect(config.providers.ollama?.baseURL).toBe("http://localhost:11434")
  })

  afterAll(async () => {
    await rt.dispose()
  })
})
