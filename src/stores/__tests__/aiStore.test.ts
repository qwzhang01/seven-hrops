/**
 * Tests for AI Store (Zustand)
 *
 * Covers: default config, setModelConfig (with platform reload semantics),
 * setConnectionStatus, setAgentStatus, clearAgentStatus, persistence
 * partialize.
 *
 * Note: aiStore no longer owns the agent runtime. Bootstrap creates it in
 * main.tsx and exposes `window.__platform.reload`. These tests therefore
 * focus on store-level state transitions plus the call to `__platform.reload`.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useAIStore } from "@/stores/aiStore";
import { capabilityRegistry } from "@/platform/registry";

// ─── Capability fixture helper ───────────────────────────────────────────

const installCapabilityFixture = (id = "resume-screening") => {
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
      agentName: "screener",
      category: "hr-screening",
      contextKeys: ["workspacePath"],
    },
  });
};

// ─── Mock Tauri ──────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// ─── Helpers ─────────────────────────────────────────────────────────

const installFakePlatform = (reload: (cfg: unknown) => Promise<void>) => {
  // Minimal stub so aiStore.setModelConfig can call into reload.
  // We don't care about the runtime / loaders — only `reload`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__platform = {
    runtime: undefined,
    agentLoader: undefined,
    skillLoader: undefined,
    capabilityRegistry: undefined,
    toolRegistry: undefined,
    reload,
  };
};

const clearPlatform = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__platform;
};

// ─── Tests ───────────────────────────────────────────────────────────

describe("AIStore — default state", () => {
  beforeEach(() => {
    useAIStore.setState({
      modelConfig: {
        providerID: "ollama",
        modelID: "qwen3:8b",
        baseURL: "http://localhost:11434",
      },
      connectionStatus: "disconnected",
      agents: {},
    });
  });

  it("has correct default model config", () => {
    const state = useAIStore.getState();
    expect(state.modelConfig.providerID).toBe("ollama");
    expect(state.modelConfig.modelID).toBe("qwen3:8b");
    expect(state.modelConfig.baseURL).toBe("http://localhost:11434");
  });

  it("starts as disconnected", () => {
    expect(useAIStore.getState().connectionStatus).toBe("disconnected");
  });

  it("starts with no agents", () => {
    expect(useAIStore.getState().agents).toEqual({});
  });
});

describe("AIStore — setModelConfig", () => {
  beforeEach(() => {
    useAIStore.setState({
      modelConfig: {
        providerID: "ollama",
        modelID: "qwen3:8b",
        baseURL: "http://localhost:11434",
      },
      connectionStatus: "disconnected",
    });
  });

  afterEach(() => {
    clearPlatform();
  });

  it("updates providerID and persists merged config when platform is absent", async () => {
    // No window.__platform — store should still update modelConfig but
    // skip reload. connectionStatus ends as 'disconnected'.
    await useAIStore.getState().setModelConfig({ providerID: "anthropic" });
    expect(useAIStore.getState().modelConfig.providerID).toBe("anthropic");
    expect(useAIStore.getState().modelConfig.modelID).toBe("qwen3:8b");
    expect(useAIStore.getState().connectionStatus).toBe("disconnected");
  });

  it("updates modelID", async () => {
    await useAIStore.getState().setModelConfig({ modelID: "gpt-4o" });
    expect(useAIStore.getState().modelConfig.modelID).toBe("gpt-4o");
  });

  it("updates apiKey", async () => {
    await useAIStore.getState().setModelConfig({ apiKey: "sk-test-123" });
    expect(useAIStore.getState().modelConfig.apiKey).toBe("sk-test-123");
  });

  it("updates baseURL", async () => {
    await useAIStore.getState().setModelConfig({ baseURL: "https://api.openai.com/v1" });
    expect(useAIStore.getState().modelConfig.baseURL).toBe("https://api.openai.com/v1");
  });

  it("updates multiple fields at once", async () => {
    await useAIStore.getState().setModelConfig({
      providerID: "openai",
      modelID: "gpt-4o",
      apiKey: "sk-new",
      baseURL: "https://api.openai.com/v1",
    });
    const config = useAIStore.getState().modelConfig;
    expect(config.providerID).toBe("openai");
    expect(config.modelID).toBe("gpt-4o");
    expect(config.apiKey).toBe("sk-new");
    expect(config.baseURL).toBe("https://api.openai.com/v1");
  });

  it("calls platform.reload and ends as 'connected' on success", async () => {
    const reload = vi.fn(() => Promise.resolve());
    installFakePlatform(reload);

    await useAIStore.getState().setModelConfig({ providerID: "anthropic" });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(useAIStore.getState().connectionStatus).toBe("connected");
  });

  it("ends as 'disconnected' and rethrows when platform.reload fails", async () => {
    const reload = vi.fn(() => Promise.reject(new Error("boom")));
    installFakePlatform(reload);

    await expect(
      useAIStore.getState().setModelConfig({ providerID: "anthropic" }),
    ).rejects.toThrow("boom");

    expect(useAIStore.getState().connectionStatus).toBe("disconnected");
  });
});

describe("AIStore — setConnectionStatus", () => {
  it("transitions from disconnected to connecting", () => {
    useAIStore.getState().setConnectionStatus("connecting");
    expect(useAIStore.getState().connectionStatus).toBe("connecting");
  });

  it("transitions from connecting to connected", () => {
    useAIStore.setState({ connectionStatus: "connecting" });
    useAIStore.getState().setConnectionStatus("connected");
    expect(useAIStore.getState().connectionStatus).toBe("connected");
  });

  it("transitions from connected to disconnected", () => {
    useAIStore.setState({ connectionStatus: "connected" });
    useAIStore.getState().setConnectionStatus("disconnected");
    expect(useAIStore.getState().connectionStatus).toBe("disconnected");
  });
});

describe("AIStore — setAgentStatus", () => {
  beforeEach(() => {
    useAIStore.setState({ agents: {} });
  });

  it("sets agent status for a new agent", () => {
    useAIStore.getState().setAgentStatus("screener", { status: "running" });
    const agent = useAIStore.getState().agents.screener;
    expect(agent).toBeDefined();
    expect(agent.status).toBe("running");
  });

  it("updates existing agent status", () => {
    useAIStore.getState().setAgentStatus("screener", { status: "running" });
    useAIStore.getState().setAgentStatus("screener", { status: "error", error: "timeout" });
    const agent = useAIStore.getState().agents.screener;
    expect(agent.status).toBe("error");
    expect(agent.error).toBe("timeout");
  });

  it("sets sessionID and currentAgent", () => {
    useAIStore.getState().setAgentStatus("screener", {
      status: "running",
      sessionID: "session-123",
      currentAgent: "screener",
    });
    const agent = useAIStore.getState().agents.screener;
    expect(agent.sessionID).toBe("session-123");
    expect(agent.currentAgent).toBe("screener");
  });

  it("preserves other agents when updating one", () => {
    useAIStore.getState().setAgentStatus("screener", { status: "running" });
    useAIStore.getState().setAgentStatus("compliance", { status: "idle" });
    expect(useAIStore.getState().agents.screener.status).toBe("running");
    expect(useAIStore.getState().agents.compliance.status).toBe("idle");
  });
});

describe("AIStore — clearAgentStatus", () => {
  it("removes an agent from the agents map", () => {
    useAIStore.setState({
      agents: {
        screener: { status: "running" },
        compliance: { status: "idle" },
      },
    });
    useAIStore.getState().clearAgentStatus("screener");
    expect(useAIStore.getState().agents.screener).toBeUndefined();
    expect(useAIStore.getState().agents.compliance).toBeDefined();
  });

  it("does not throw when clearing non-existent agent", () => {
    useAIStore.setState({ agents: {} });
    expect(() => useAIStore.getState().clearAgentStatus("nonexistent")).not.toThrow();
  });
});

describe("AIStore — persistence", () => {
  afterEach(() => clearPlatform());

  it("only persists modelConfig (not connectionStatus or agents)", async () => {
    // No platform → setModelConfig will skip reload but still persist.
    await useAIStore.getState().setModelConfig({ providerID: "openai" });
    useAIStore.getState().setConnectionStatus("connected");
    useAIStore.getState().setAgentStatus("screener", { status: "running" });

    const stored = JSON.parse(localStorage.getItem("seven-hrops-ai") || "{}");
    expect(stored.state.modelConfig.providerID).toBe("openai");
    // connectionStatus and agents should NOT be persisted
    expect(stored.state.connectionStatus).toBeUndefined();
    expect(stored.state.agents).toBeUndefined();
  });
});

// ─── D10: Chat state tests ────────────────────────────────────────────

describe("AIStore — chat: appendMessage", () => {
  beforeEach(() => {
    useAIStore.setState({ messages: [], isTyping: false, activeSessionId: null });
  });

  it("appends a message to the list", () => {
    const msg = {
      id: "m1",
      role: "user" as const,
      type: "text" as const,
      content: "hello",
      timestamp: 1000,
    };
    useAIStore.getState().appendMessage(msg);
    expect(useAIStore.getState().messages).toHaveLength(1);
    expect(useAIStore.getState().messages[0].content).toBe("hello");
  });

  it("appends multiple messages in order", () => {
    useAIStore.getState().appendMessage({ id: "m1", role: "user", type: "text", content: "a", timestamp: 1 });
    useAIStore.getState().appendMessage({ id: "m2", role: "assistant", type: "text", content: "b", timestamp: 2 });
    const msgs = useAIStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe("m1");
    expect(msgs[1].id).toBe("m2");
  });
});

describe("AIStore — chat: appendDelta", () => {
  beforeEach(() => {
    useAIStore.setState({
      messages: [
        { id: "asst-1", role: "assistant", type: "text", content: "Hello", timestamp: 1 },
      ],
      isTyping: true,
    });
  });

  it("appends text delta to the target message", () => {
    useAIStore.getState().appendDelta("asst-1", " world");
    expect(useAIStore.getState().messages[0].content).toBe("Hello world");
  });

  it("does not affect other messages", () => {
    useAIStore.setState({
      messages: [
        { id: "m1", role: "user", type: "text", content: "hi", timestamp: 1 },
        { id: "m2", role: "assistant", type: "text", content: "hey", timestamp: 2 },
      ],
    });
    useAIStore.getState().appendDelta("m2", "!");
    expect(useAIStore.getState().messages[0].content).toBe("hi");
    expect(useAIStore.getState().messages[1].content).toBe("hey!");
  });

  it("is a no-op for unknown messageId", () => {
    useAIStore.getState().appendDelta("unknown-id", " extra");
    expect(useAIStore.getState().messages[0].content).toBe("Hello");
  });
});

describe("AIStore — chat: clearMessages", () => {
  it("clears all messages and resets isTyping", () => {
    useAIStore.setState({
      messages: [
        { id: "m1", role: "user", type: "text", content: "hi", timestamp: 1 },
      ],
      isTyping: true,
    });
    useAIStore.getState().clearMessages();
    expect(useAIStore.getState().messages).toHaveLength(0);
    expect(useAIStore.getState().isTyping).toBe(false);
  });
});

describe("AIStore — chat: sendMessage", () => {
  beforeEach(() => {
    clearPlatform();
    capabilityRegistry.resetForTest();
    useAIStore.setState({ messages: [], isTyping: false, activeSessionId: null });
  });

  afterEach(() => {
    clearPlatform();
    capabilityRegistry.resetForTest();
  });

  it("appends user message and assistant message, then sets isTyping false after stream", async () => {
    installCapabilityFixture();
    // No platform → mock mode: chatWithStream emits text-delta + finish
    await useAIStore.getState().sendMessage("你好", "resume-screening");

    const msgs = useAIStore.getState().messages;
    // user + assistant
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("你好");
    expect(msgs[1].role).toBe("assistant");
    // After stream finishes, isTyping should be false
    expect(useAIStore.getState().isTyping).toBe(false);
    // Assistant message should have content (from mock stream)
    expect(msgs[1].content.length).toBeGreaterThan(0);
  });

  it("sets isTyping to true during streaming", async () => {
    installCapabilityFixture();
    let typingDuringStream = false;
    // Intercept appendDelta to check isTyping mid-stream
    const originalAppend = useAIStore.getState().appendDelta;
    const spy = vi.spyOn(useAIStore.getState(), "appendDelta").mockImplementation((id, text) => {
      typingDuringStream = useAIStore.getState().isTyping;
      originalAppend(id, text);
    });

    await useAIStore.getState().sendMessage("test", "resume-screening");
    spy.mockRestore();

    // isTyping was true at some point during streaming
    expect(typingDuringStream).toBe(true);
    // After completion, isTyping is false
    expect(useAIStore.getState().isTyping).toBe(false);
  });

  // ── arch-capability-agent-contract: terminal-state guarantees ────────────────

  it("resets isTyping when chatWithStream throws synchronously (CapabilityNotFoundError)", async () => {
    // No fixture installed → chatWithStream emits an error event for
    // the unknown capability. The withStreaming finally must still
    // reset isTyping.
    await useAIStore.getState().sendMessage("hi", "unknown-capability");

    expect(useAIStore.getState().isTyping).toBe(false);
    const msgs = useAIStore.getState().messages;
    const errorMsg = msgs.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
  });

  it("refuses to send when capabilityId is undefined and does not pollute the message list", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await useAIStore.getState().sendMessage("hi");
    expect(useAIStore.getState().messages).toHaveLength(0);
    expect(useAIStore.getState().isTyping).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("resets isTyping even when chatWithStream resolves without a finish event", async () => {
    installCapabilityFixture();
    // Mock chatWithStream so it emits text-delta but never finish.
    vi.doMock("@/services/agentService", () => ({
      chatWithStream: async (
        _req: unknown,
        onEvent: (e: { type: string; sessionID: string; messageID: string; text?: string }) => void,
      ) => {
        onEvent({ type: "text-delta", sessionID: "s", messageID: "m", text: "hello" });
        // intentionally no finish event
      },
    }));

    try {
      await useAIStore.getState().sendMessage("hi", "resume-screening");
      // Even without a finish event, withStreaming's finally must reset.
      expect(useAIStore.getState().isTyping).toBe(false);
    } finally {
      vi.doUnmock("@/services/agentService");
    }
  });

  it("maps CapabilityDisabledError to a readable Chinese message", async () => {
    installCapabilityFixture();
    capabilityRegistry.disable("resume-screening");

    await useAIStore.getState().sendMessage("hi", "resume-screening");

    const errorMsg = useAIStore.getState().messages.find((m) => m.type === "error");
    expect(errorMsg).toBeDefined();
    // The agentService maps CapabilityDisabledError into the error
    // event's `error` string (CapabilityDisabledError.message). The
    // store — in this path — simply forwards the streamed error
    // string. We at minimum require the disabled-keyword to surface.
    expect(errorMsg!.content).toMatch(/disabled|禁用/i);
  });
});
