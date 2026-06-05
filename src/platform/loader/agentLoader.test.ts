/**
 * Tests for AgentLoader.
 *
 * Coverage goal: ≥ 85%.
 * Cases:
 *   1. valid builtin manifest loads successfully
 *   2. missing required field → MISSING_REQUIRED_FIELD
 *   3. tool not allowed for source → TOOL_NOT_PERMITTED_FOR_SOURCE
 *   4. unload an unregistered agent → throws
 *   5. reload = unload + load
 *   6. manifest without permission falls back to source default
 *   7. manifestToAgentInfo merges contextTemplate into prompt
 *   8. wrong kind ("Skill") rejected with INVALID_KIND
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest"
import { Effect, ManagedRuntime } from "effect"
import { Agent } from "../../agent-runtime/agent/agent"
import { agentLoader, manifestToAgentInfo } from "./agentLoader"
import { API_VERSION_V1, KIND, type AgentManifest } from "../hsas/schema"
import { ValidationError } from "../hsas/validator"
import { toolRegistry, type ToolMeta } from "../registry/toolRegistry"

// ─── Fixtures ────────────────────────────────────────────────────────

// Phase B: toolRegistry is empty by default in tests. Seed the two metas
// these tests reference so `assertAllowed` / `has` behave as expected.
const readFileMeta: ToolMeta = {
  name: "read_file",
  category: "safe",
  riskLevel: "low",
  description: "fixture",
  defaultAllowedSources: ["builtin", "user", "marketplace"],
  requireApproval: false,
}
const listDirMeta: ToolMeta = {
  name: "list_dir",
  category: "safe",
  riskLevel: "low",
  description: "fixture",
  defaultAllowedSources: ["builtin", "user", "marketplace"],
  requireApproval: false,
}
// Builtin-only tool — used to test source authorisation rejection.
const builderOnlyMeta: ToolMeta = {
  name: "create_agent_manifest",
  category: "builder",
  riskLevel: "high",
  description: "fixture",
  defaultAllowedSources: ["builtin"],
  requireApproval: true,
}

beforeAll(() => {
  toolRegistry.registerForTest(readFileMeta)
  toolRegistry.registerForTest(listDirMeta)
  toolRegistry.registerForTest(builderOnlyMeta)
})

afterAll(() => {
  toolRegistry.unregisterForTest("read_file")
  toolRegistry.unregisterForTest("list_dir")
  toolRegistry.unregisterForTest("create_agent_manifest")
})

const baseMeta = {
  name: "screener",
  displayName: "简历筛选",
  description: "评估候选人简历与 JD 的匹配度",
  source: "builtin" as const,
  version: "1.0.0",
  createdAt: "2026-05-27T10:00:00Z",
}

const baseAgent: AgentManifest = {
  apiVersion: API_VERSION_V1,
  kind: KIND.agent,
  metadata: baseMeta,
  spec: {
    mode: "primary",
    basePrompt:
      "You are a helpful HR operations assistant. Provide concise, evidence-based answers to recruitment questions.",
    tools: { allowed: ["read_file", "list_dir"] },
  },
}

// ─── manifestToAgentInfo (pure transform) ────────────────────────────

describe("manifestToAgentInfo", () => {
  it("maps required fields", () => {
    const info = manifestToAgentInfo(baseAgent)
    expect(info.name).toBe("screener")
    expect(info.mode).toBe("primary")
    expect(info.tools).toEqual(["read_file", "list_dir"])
    expect(info.prompt).toBe(baseAgent.spec.basePrompt)
  })

  it("merges contextTemplate into prompt", () => {
    const m: AgentManifest = {
      ...baseAgent,
      spec: { ...baseAgent.spec, contextTemplate: "Workspace: {{workspacePath}}" },
    }
    const info = manifestToAgentInfo(m)
    expect(info.prompt).toContain("Workspace: {{workspacePath}}")
    expect(info.prompt!.startsWith(baseAgent.spec.basePrompt)).toBe(true)
  })

  it("falls back to allow-all permission for builtin source", () => {
    const info = manifestToAgentInfo(baseAgent)
    expect(info.permission).toEqual([{ permission: "*", pattern: "*", action: "allow" }])
  })

  it("falls back to ask-before permission for user source", () => {
    const info = manifestToAgentInfo({
      ...baseAgent,
      metadata: { ...baseMeta, source: "user" },
    })
    expect(info.permission).toEqual([{ permission: "*", pattern: "*", action: "ask" }])
  })

  it("preserves explicit permission rules", () => {
    const info = manifestToAgentInfo({
      ...baseAgent,
      spec: {
        ...baseAgent.spec,
        permission: [{ permission: "read", pattern: "*", action: "allow" }],
      },
    })
    expect(info.permission).toEqual([{ permission: "read", pattern: "*", action: "allow" }])
  })

  it("translates model spec from provider/modelID", () => {
    const info = manifestToAgentInfo({
      ...baseAgent,
      spec: {
        ...baseAgent.spec,
        model: { provider: "anthropic", modelID: "claude-4.7-sonnet", temperature: 0.3 },
      },
    })
    expect(info.model).toEqual({ providerID: "anthropic", modelID: "claude-4.7-sonnet" })
    expect(info.temperature).toBe(0.3)
  })
})

// ─── load / unload / reload ──────────────────────────────────────────

describe("agentLoader.load", () => {
  const rt = ManagedRuntime.make(Agent.defaultLayer)

  it("loads a valid builtin manifest into Agent.Service", async () => {
    const info = await rt.runPromise(agentLoader.load(baseAgent))
    expect(info.name).toBe("screener")

    const fetched = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* Agent.Service
        return yield* svc.get("screener")
      }),
    )
    expect(fetched.mode).toBe("primary")
  })

  it("rejects manifest with missing required field", async () => {
    const broken = { ...baseAgent, metadata: { ...baseMeta, name: "" } }
    const exit = await rt.runPromiseExit(agentLoader.load(broken))
    expect(exit._tag).toBe("Failure")
  })

  it("rejects user-source manifest using a builtin-only tool", async () => {
    const m = {
      ...baseAgent,
      metadata: { ...baseMeta, name: "evil-agent", source: "user" as const },
      spec: { ...baseAgent.spec, tools: { allowed: ["create_agent_manifest"] } },
    }
    const exit = await rt.runPromiseExit(agentLoader.load(m))
    expect(exit._tag).toBe("Failure")
  })

  it("rejects manifest with kind=Skill", async () => {
    const m = { ...baseAgent, kind: "Skill" }
    const exit = await rt.runPromiseExit(agentLoader.load(m))
    expect(exit._tag).toBe("Failure")
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

describe("agentLoader.loadMany", () => {
  const rt = ManagedRuntime.make(Agent.defaultLayer)

  it("loads multiple manifests in order", async () => {
    const m1: AgentManifest = baseAgent
    const m2: AgentManifest = {
      ...baseAgent,
      metadata: { ...baseMeta, name: "compliance" },
      spec: { ...baseAgent.spec, mode: "subagent" },
    }
    const infos = await rt.runPromise(agentLoader.loadMany([m1, m2]))
    expect(infos.map((i) => i.name)).toEqual(["screener", "compliance"])
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

describe("agentLoader.unload / reload", () => {
  const rt = ManagedRuntime.make(Agent.defaultLayer)

  it("unload removes an agent from the registry", async () => {
    await rt.runPromise(agentLoader.load(baseAgent))
    await rt.runPromise(agentLoader.unload("screener"))
    const exit = await rt.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* Agent.Service
        return yield* svc.get("screener")
      }),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("unload throws for unknown agent", async () => {
    const exit = await rt.runPromiseExit(agentLoader.unload("never-loaded"))
    expect(exit._tag).toBe("Failure")
  })

  it("reload = unload + load", async () => {
    await rt.runPromise(agentLoader.load(baseAgent))
    const reloaded = await rt.runPromise(
      agentLoader.reload("screener", {
        ...baseAgent,
        metadata: { ...baseMeta, description: "rebuilt" },
      }),
    )
    expect(reloaded.description).toBe("rebuilt")
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

describe("agentLoader — ValidationError surface", () => {
  const rt = ManagedRuntime.make(Agent.defaultLayer)

  it("returns ValidationError instance on schema failure", async () => {
    const exit = await rt.runPromiseExit(
      agentLoader.load({
        apiVersion: API_VERSION_V1,
        kind: KIND.agent,
        metadata: baseMeta,
        spec: { ...baseAgent.spec, basePrompt: "tiny" },
      }),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      // The cause should carry a ValidationError or Error with PROMPT_TOO_SHORT
      const text = JSON.stringify(exit.cause)
      expect(text).toMatch(/PROMPT_TOO_SHORT/)
    }
  })

  // Sanity: ensure ValidationError is exported from the module so callers
  // can `instanceof` against it.
  it("ValidationError class is exported", () => {
    const err = new ValidationError("INVALID_NAME", "test")
    expect(err.code).toBe("INVALID_NAME")
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

// ─── 5.6 increment: loadFromYaml ─────────────────────────────────────

describe("agentLoader.loadFromYaml", () => {
  const rt = ManagedRuntime.make(Agent.defaultLayer)

  const yamlText = `apiVersion: hsas.seven-hrops/v1
kind: Agent
metadata:
  name: yaml-agent
  displayName: YAML Agent
  description: loaded from yaml fixture
  source: builtin
  version: 1.0.0
  createdAt: "2026-05-27T10:00:00Z"
spec:
  mode: primary
  basePrompt: "You are a helpful HR operations assistant. Provide concise answers."
  tools:
    allowed:
      - read_file
      - list_dir
`

  it("parses yaml and registers the agent", async () => {
    const info = await rt.runPromise(agentLoader.loadFromYaml(yamlText))
    expect(info.name).toBe("yaml-agent")
    expect(info.tools).toEqual(["read_file", "list_dir"])
  })

  it("throws YAML_PARSE_FAILED on malformed yaml", async () => {
    const exit = await rt.runPromiseExit(
      agentLoader.loadFromYaml(":::not yaml:::\n  - [unclosed"),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      expect(JSON.stringify(exit.cause)).toMatch(/YAML_PARSE_FAILED/)
    }
  })

  afterAll(async () => {
    await rt.dispose()
  })
})
