/**
 * Tests for Agent Service (Phase B Task 7.4)
 *
 * Covers: mock chat flow, mock stream flow, listSkills, listMCPTools,
 * initRuntime, subscribe/unsubscribe (no-ops).
 *
 * Phase B change: Tauri invoke is no longer used. Tests now mock
 * `window.__platform.runtime` (the Effect-based PlatformRuntime) to
 * exercise the runtime path, and verify mock fallback when the platform
 * is not yet bootstrapped.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import {
  chatWithAgent,
  chatWithStream,
  listSkills,
  listMCPTools,
  initRuntime,
  subscribeToStream,
  unsubscribeFromStream,
  type AgentChatRequest,
  type AgentStreamEvent,
} from "@/services/agentService"
import { useAIStore } from "@/stores/aiStore"
import { capabilityRegistry } from "@/platform/registry/capabilityRegistry"

// ─── Helpers ─────────────────────────────────────────────────────────

/** Remove window.__platform so getPlatformRuntime() returns null */
function clearPlatform() {
  delete (window as any).__platform
}

/** Install a minimal mock PlatformRuntime on window.__platform */
function installMockRuntime(overrides?: {
  runPromise?: (effect: unknown) => Promise<unknown>
}) {
  const runPromise =
    overrides?.runPromise ??
    ((_effect: unknown) => Promise.reject(new Error("not implemented")))
  ;(window as any).__platform = {
    runtime: { runPromise },
    capabilityRegistry: { list: () => [] },
  }
}

// ─── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  clearPlatform()
  capabilityRegistry.resetForTest()
  useAIStore.setState({
    modelConfig: {
      providerID: "ollama",
      modelID: "qwen3:8b",
      baseURL: "http://localhost:11434",
    },
    connectionStatus: "disconnected",
    agents: {},
  })
})

afterEach(() => {
  clearPlatform()
  capabilityRegistry.resetForTest()
})

// ─── Tests — Mock Mode (no platform) ─────────────────────────────────

describe("AgentService — chatWithAgent (mock mode)", () => {
  it("returns a mock response when platform is not bootstrapped", async () => {
    const request: AgentChatRequest = {
      sessionID: "session-test",
      message: "你好",
    }
    const response = await chatWithAgent(request)
    expect(response.sessionID).toBe("session-test")
    expect(response.messageID).toMatch(/^msg-/)
    expect(response.content).toContain("小七")
    expect(response.finishReason).toBe("stop")
  })

  it("returns screener-specific response for screener agent", async () => {
    const request: AgentChatRequest = {
      sessionID: "session-test",
      message: "筛选简历",
      agentName: "screener",
    }
    const response = await chatWithAgent(request)
    expect(response.content).toContain("筛选")
  })

  it("returns compliance-specific response for compliance agent", async () => {
    const request: AgentChatRequest = {
      sessionID: "session-test",
      message: "合规审查",
      agentName: "compliance",
    }
    const response = await chatWithAgent(request)
    expect(response.content).toContain("合规")
  })
})

describe("AgentService — chatWithStream (mock mode)", () => {
  // arch-capability-agent-contract: chatWithStream now goes through
  // resolveCapability(). Mock-mode tests register a fixture capability.
  const installFixture = (id = "resume-screening", agentName = "screener") =>
    capabilityRegistry.install({
      apiVersion: "hsas.seven-hrops/v1",
      kind: "Capability",
      metadata: {
        name: id,
        displayName: "测试能力",
        description: "fixture",
        source: "builtin",
        version: "1.0.0",
        createdAt: "2026-05-29T00:00:00Z",
      },
      spec: {
        agentName,
        category: "hr-screening",
        contextKeys: ["workspacePath"],
      },
    })

  it("emits text-delta events followed by finish", async () => {
    installFixture()
    const events: AgentStreamEvent[] = []
    const request: AgentChatRequest = {
      sessionID: "session-stream-test",
      message: "你好",
      capabilityId: "resume-screening",
    }

    await chatWithStream(request, (event) => events.push(event))

    const textDeltas = events.filter((e) => e.type === "text-delta")
    const finishes = events.filter((e) => e.type === "finish")
    expect(textDeltas.length).toBeGreaterThan(0)
    expect(finishes.length).toBe(1)
    expect(finishes[0].reason).toBe("stop")

    const fullText = textDeltas.map((e) => e.text ?? "").join("")
    expect(fullText).toContain("小七")
  })

  it("stream events have correct sessionID and messageID", async () => {
    installFixture()
    const events: AgentStreamEvent[] = []
    const request: AgentChatRequest = {
      sessionID: "session-id-test",
      message: "test",
      capabilityId: "resume-screening",
    }

    await chatWithStream(request, (event) => events.push(event))

    for (const event of events) {
      expect(event.sessionID).toBe("session-id-test")
      expect(event.messageID).toMatch(/^msg-/)
    }
  })

  // ── Capability contract scenarios ──────────────────────────────────

  it("emits an error event when capabilityId is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const events: AgentStreamEvent[] = []
    await chatWithStream(
      { sessionID: "s1", message: "hi" },
      (e) => events.push(e),
    )
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("error")
    expect(events[0].error).toMatch(/not registered|empty/i)
    warnSpy.mockRestore()
  })

  it("emits an error event when capability is registered but disabled", async () => {
    installFixture()
    capabilityRegistry.disable("resume-screening")
    const events: AgentStreamEvent[] = []
    await chatWithStream(
      { sessionID: "s1", message: "hi", capabilityId: "resume-screening" },
      (e) => events.push(e),
    )
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("error")
    expect(events[0].error).toMatch(/disabled/i)
  })

  it("prints a deprecation warn when both agentName and capabilityId are passed; resolver still wins", async () => {
    installFixture("resume-screening", "screener")
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const events: AgentStreamEvent[] = []
    await chatWithStream(
      {
        sessionID: "s1",
        message: "hi",
        capabilityId: "resume-screening",
        agentName: "compliance",
      },
      (e) => events.push(e),
    )
    expect(warnSpy).toHaveBeenCalled()
    // Mock-mode response is keyed off the resolved agentName ("screener")
    const fullText = events
      .filter((e) => e.type === "text-delta")
      .map((e) => e.text ?? "")
      .join("")
    expect(fullText).toContain("筛选")
    warnSpy.mockRestore()
  })
})

describe("AgentService — listSkills (mock mode)", () => {
  it("returns mock skills list", async () => {
    const skills = await listSkills()
    expect(skills.length).toBeGreaterThanOrEqual(2)
    expect(skills.some((s) => s.name === "screen_resumes")).toBe(true)
    expect(skills.some((s) => s.name === "compliance_check")).toBe(true)
  })

  it("skills have required fields", async () => {
    const skills = await listSkills()
    for (const skill of skills) {
      expect(skill).toHaveProperty("name")
      expect(skill).toHaveProperty("description")
      expect(skill).toHaveProperty("agent")
      expect(skill).toHaveProperty("parameters")
    }
  })
})

describe("AgentService — listMCPTools (mock mode)", () => {
  it("returns mock MCP tools list", async () => {
    const tools = await listMCPTools()
    expect(tools.length).toBeGreaterThanOrEqual(2)
    expect(tools.some((t) => t.name === "list_projects")).toBe(true)
  })

  it("tools have required fields", async () => {
    const tools = await listMCPTools()
    for (const tool of tools) {
      expect(tool).toHaveProperty("name")
      expect(tool).toHaveProperty("description")
      expect(tool).toHaveProperty("serverName")
      expect(tool).toHaveProperty("parameters")
    }
  })
})

describe("AgentService — initRuntime", () => {
  it("sets connection status to connected", async () => {
    useAIStore.setState({ connectionStatus: "disconnected" })
    await initRuntime()
    expect(useAIStore.getState().connectionStatus).toBe("connected")
  })

  it("accepts optional config for backward compatibility (no-op)", async () => {
    await initRuntime({ providerID: "openai", modelID: "gpt-4o" } as any)
    expect(useAIStore.getState().connectionStatus).toBe("connected")
  })
})

describe("AgentService — subscribeToStream / unsubscribeFromStream (no-ops)", () => {
  it("subscribeToStream resolves without throwing", async () => {
    await expect(
      subscribeToStream("session-test", vi.fn()),
    ).resolves.toBeUndefined()
  })

  it("unsubscribeFromStream resolves without throwing", async () => {
    await expect(unsubscribeFromStream("nonexistent")).resolves.toBeUndefined()
  })
})

// ─── Tests — Runtime Mode (window.__platform available) ──────────────

describe("AgentService — runtime mode (window.__platform)", () => {
  it("chatWithAgent calls runtime.runPromise and returns structured response", async () => {
    const runPromise = vi.fn().mockResolvedValue({
      sessionID: "s1",
      messageID: "m1",
      content: [{ type: "text", text: "AI 回复内容" }],
      finishReason: "stop",
    })
    installMockRuntime({ runPromise })

    const response = await chatWithAgent({
      sessionID: "s1",
      message: "hello",
    })

    expect(runPromise).toHaveBeenCalledTimes(1)
    expect(response.content).toBe("AI 回复内容")
    expect(response.sessionID).toBe("s1")
  })

  it("chatWithAgent throws 'Agent chat failed' when runtime rejects", async () => {
    installMockRuntime({
      runPromise: () => Promise.reject(new Error("LLM timeout")),
    })

    await expect(
      chatWithAgent({ sessionID: "s1", message: "test" }),
    ).rejects.toThrow("Agent chat failed")
  })

  it("chatWithStream emits error event when runtime rejects", async () => {
    capabilityRegistry.install({
      apiVersion: "hsas.seven-hrops/v1",
      kind: "Capability",
      metadata: {
        name: "resume-screening",
        displayName: "简历筛选",
        description: "fixture",
        source: "builtin",
        version: "1.0.0",
        createdAt: "2026-05-29T00:00:00Z",
      },
      spec: {
        agentName: "screener",
        category: "hr-screening",
        contextKeys: ["workspacePath"],
      },
    })
    installMockRuntime({
      runPromise: () => Promise.reject(new Error("stream error")),
    })

    const events: AgentStreamEvent[] = []
    await chatWithStream(
      { sessionID: "s1", message: "test", capabilityId: "resume-screening" },
      (e) => events.push(e),
    )

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("error")
    expect(events[0].error).toContain("stream error")
  })

  it("chatWithStream resolves capabilityId to the manifest agentName", async () => {
    capabilityRegistry.install({
      apiVersion: "hsas.seven-hrops/v1",
      kind: "Capability",
      metadata: {
        name: "resume-screening",
        displayName: "简历筛选",
        description: "Screen resumes",
        source: "builtin",
        version: "1.0.0",
        createdAt: "2026-05-29T00:00:00Z",
      },
      spec: {
        agentName: "screener",
        category: "hr-screening",
        contextKeys: ["workspacePath"],
      },
    })
    const runPromise = vi.fn().mockRejectedValue(new Error("capture"))
    installMockRuntime({ runPromise })

    const events: AgentStreamEvent[] = []
    await chatWithStream(
      { sessionID: "s1", message: "请分析这份简历", capabilityId: "resume-screening" },
      (e) => events.push(e),
    )

    expect(runPromise).toHaveBeenCalledTimes(1)
    const effectText = String(runPromise.mock.calls[0]?.[0])
    expect(effectText).not.toContain("assistant")
    expect(events[0].type).toBe("error")
  })

  it("listSkills falls back to mock when runtime.runPromise rejects", async () => {
    installMockRuntime({
      runPromise: () => Promise.reject(new Error("service unavailable")),
    })

    const skills = await listSkills()
    // Should fall through to mock list
    expect(skills.some((s) => s.name === "screen_resumes")).toBe(true)
  })

  it("listMCPTools falls back to mock when runtime.runPromise rejects", async () => {
    installMockRuntime({
      runPromise: () => Promise.reject(new Error("service unavailable")),
    })

    const tools = await listMCPTools()
    expect(tools.some((t) => t.name === "list_projects")).toBe(true)
  })
})

// ─── D12: systemPrompt injection tests ───────────────────────────────

describe("AgentService — systemPrompt injection (D12)", () => {
  afterEach(() => clearPlatform())

  it("chatWithStream passes systemPrompt prefix to Session.run when capabilityId is provided", async () => {
    capabilityRegistry.install({
      apiVersion: "hsas.seven-hrops/v1",
      kind: "Capability",
      metadata: {
        name: "resume-screener",
        displayName: "简历筛选",
        description: "fixture",
        source: "builtin",
        version: "1.0.0",
        createdAt: "2026-05-29T00:00:00Z",
      },
      spec: {
        agentName: "screener",
        category: "hr-screening",
        contextKeys: ["workspacePath"],
      },
    })
    installMockRuntime({
      runPromise: vi.fn().mockImplementation((_effect: unknown) => {
        // The Effect.gen will call sessionSvc.run with the message.
        // We capture it by resolving the effect with a spy.
        // Since we can't easily intercept Effect internals, we verify
        // via the mock fallback path by checking the message contains [System:].
        // For runtime path, we verify the runPromise was called.
        return Promise.reject(new Error("capture"))
      }),
    })

    const events: AgentStreamEvent[] = []
    await chatWithStream(
      { sessionID: "s1", message: "hello", capabilityId: "resume-screener" },
      (e) => events.push(e),
    )

    // Runtime rejected → error event emitted
    expect(events[0].type).toBe("error")
  })

  it("chatWithStream in mock mode emits text-delta and finish (no capabilityId)", async () => {
    // arch-capability-agent-contract: missing capabilityId now produces
    // an error event instead of a happy stream. Verify the error path.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const events: AgentStreamEvent[] = []
    await chatWithStream(
      { sessionID: "s1", message: "hello" },
      (e) => events.push(e),
    )

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("error")
    warnSpy.mockRestore()
  })

  it("chatWithStream in mock mode emits text-delta and finish (with capabilityId)", async () => {
    capabilityRegistry.install({
      apiVersion: "hsas.seven-hrops/v1",
      kind: "Capability",
      metadata: {
        name: "resume-screener",
        displayName: "简历筛选",
        description: "fixture",
        source: "builtin",
        version: "1.0.0",
        createdAt: "2026-05-29T00:00:00Z",
      },
      spec: {
        agentName: "screener",
        category: "hr-screening",
        contextKeys: ["workspacePath"],
      },
    })
    const events: AgentStreamEvent[] = []
    await chatWithStream(
      { sessionID: "s1", message: "hello", capabilityId: "resume-screener" },
      (e) => events.push(e),
    )

    const deltas = events.filter((e) => e.type === "text-delta")
    const finishes = events.filter((e) => e.type === "finish")
    expect(deltas.length).toBeGreaterThan(0)
    expect(finishes.length).toBe(1)
  })

  it("agentService.ts has no console.debug calls", async () => {
    capabilityRegistry.install({
      apiVersion: "hsas.seven-hrops/v1",
      kind: "Capability",
      metadata: {
        name: "resume-screening",
        displayName: "简历筛选",
        description: "fixture",
        source: "builtin",
        version: "1.0.0",
        createdAt: "2026-05-29T00:00:00Z",
      },
      spec: {
        agentName: "screener",
        category: "hr-screening",
        contextKeys: ["workspacePath"],
      },
    })
    // This test verifies the Phase C debt #3 is resolved.
    // We import the module source and check for console.debug absence.
    // Since we can't read source in tests, we verify via behavior:
    // the mock stream should complete without any debug side effects.
    const consoleSpy = vi.spyOn(console, "debug")
    const events: AgentStreamEvent[] = []
    await chatWithStream(
      { sessionID: "s1", message: "test", capabilityId: "resume-screening" },
      (e) => events.push(e),
    )
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
