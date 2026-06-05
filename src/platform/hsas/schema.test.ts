/**
 * Tests for HSAS manifestSchema.ts.
 *
 * Coverage goal: 100% line coverage for manifestSchema.ts.
 *
 * Strategy: for each kind we provide
 *   - a "minimum-valid" fixture (only required fields) → must decode
 *   - a "fully-valid" fixture (all optional fields) → must decode
 *   - one or more "invalid" fixtures (each violates a single rule) → must throw
 *
 * Plus extra cases for shared scalars (Name, SemVer, Source, Metadata).
 */

import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import {
  AgentManifest,
  CapabilityManifest,
  Metadata,
  Name,
  SemVer,
  SkillManifest,
  Source,
  KIND,
  API_VERSION_V1,
  type AnyManifest,
} from "./schema"

// ─── Helpers ─────────────────────────────────────────────────────────

const decode = <A, I>(s: Schema.Codec<A, I, never>, v: unknown): A =>
  Schema.decodeUnknownSync(s)(v)

const expectFail = <A, I>(s: Schema.Codec<A, I, never>, v: unknown): void => {
  expect(() => Schema.decodeUnknownSync(s)(v)).toThrow()
}

// ─── Common scalars ──────────────────────────────────────────────────

describe("Name", () => {
  it("accepts valid lowercase-hyphen names", () => {
    expect(decode(Name, "screener")).toBe("screener")
    expect(decode(Name, "my-tech-screener")).toBe("my-tech-screener")
    expect(decode(Name, "agent-007")).toBe("agent-007")
  })

  it("rejects names that do not match the regex", () => {
    expectFail(Name, "A-name") // uppercase head
    expectFail(Name, "name@x") // illegal char
    expectFail(Name, "中文名") // non-ASCII
    expectFail(Name, "ab") // too short
    expectFail(Name, "1abc") // starts with digit
    expectFail(Name, "abc-") // ends with hyphen
  })

  it("rejects names with consecutive hyphens", () => {
    expectFail(Name, "name--invalid")
  })
})

describe("SemVer", () => {
  it("accepts standard semver", () => {
    expect(decode(SemVer, "1.0.0")).toBe("1.0.0")
    expect(decode(SemVer, "0.1.0")).toBe("0.1.0")
    expect(decode(SemVer, "10.20.30")).toBe("10.20.30")
  })

  it("accepts pre-release tags", () => {
    expect(decode(SemVer, "1.0.0-beta.1")).toBe("1.0.0-beta.1")
    expect(decode(SemVer, "2.3.4-rc.2")).toBe("2.3.4-rc.2")
  })

  it("rejects malformed versions", () => {
    expectFail(SemVer, "1.0")
    expectFail(SemVer, "v1.0.0")
    expectFail(SemVer, "1.0.0.0")
  })
})

describe("Source", () => {
  it("accepts the three legal values", () => {
    expect(decode(Source, "builtin")).toBe("builtin")
    expect(decode(Source, "user")).toBe("user")
    expect(decode(Source, "marketplace")).toBe("marketplace")
  })

  it("rejects out-of-enum values", () => {
    expectFail(Source, "system")
    expectFail(Source, "")
  })
})

// ─── Metadata ────────────────────────────────────────────────────────

const goodMeta = {
  name: "screener",
  displayName: "简历筛选",
  description: "评估候选人简历与 JD 的匹配度",
  source: "builtin",
  version: "1.0.0",
  createdAt: "2026-05-27T10:00:00Z",
}

describe("Metadata", () => {
  it("accepts the minimum-valid metadata", () => {
    const m = decode(Metadata, goodMeta)
    expect(m.name).toBe("screener")
    expect(m.source).toBe("builtin")
  })

  it("accepts metadata with all optional fields", () => {
    const m = decode(Metadata, {
      ...goodMeta,
      author: "zhangsan",
      authorEmail: "san@example.com",
      icon: "🧑‍💻",
      tags: ["screening", "tech"],
      updatedAt: "2026-05-28T10:00:00Z",
      deprecated: false,
      homepage: "https://example.com",
      signature: "abc",
    })
    expect(m.author).toBe("zhangsan")
    expect(m.tags).toEqual(["screening", "tech"])
  })

  it("rejects metadata with description > 200 chars", () => {
    expectFail(Metadata, { ...goodMeta, description: "x".repeat(201) })
  })

  it("rejects metadata with displayName too long", () => {
    expectFail(Metadata, { ...goodMeta, displayName: "y".repeat(65) })
  })

  it("rejects metadata with > 10 tags", () => {
    expectFail(Metadata, {
      ...goodMeta,
      tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
    })
  })
})

// ─── Agent ───────────────────────────────────────────────────────────

const minAgent = {
  apiVersion: API_VERSION_V1,
  kind: KIND.agent,
  metadata: goodMeta,
  spec: {
    mode: "primary",
    basePrompt:
      "You are a helpful HR assistant. Provide concise, evidence-based answers " +
      "to recruitment questions.",
    tools: { allowed: [] },
  },
}

describe("AgentManifest", () => {
  it("accepts the minimum-valid agent", () => {
    const a = decode(AgentManifest, minAgent)
    expect(a.metadata.name).toBe("screener")
    expect(a.spec.tools.allowed).toEqual([])
  })

  it("accepts a fully-specified agent", () => {
    const a = decode(AgentManifest, {
      ...minAgent,
      spec: {
        mode: "subagent",
        basePrompt: minAgent.spec.basePrompt,
        contextTemplate: "Workspace: {{workspacePath}}",
        contextKeys: ["workspacePath"],
        skills: ["screener"],
        inheritFrom: { name: "screener", overrides: ["basePrompt"] },
        tools: {
          allowed: ["read_file"],
          deny: ["delete_resume"],
          autoApprove: ["read_file"],
        },
        permission: [
          { permission: "read", pattern: "*", action: "allow" },
        ],
        model: {
          provider: "anthropic",
          modelID: "claude-4.7-sonnet",
          temperature: 0.3,
          maxTokens: 4096,
          topP: 0.95,
        },
        resources: {
          maxTokensPerSession: 100000,
          maxToolCallsPerMinute: 60,
          maxConcurrentSessions: 3,
        },
        network: { allowedHosts: ["api.anthropic.com"] },
        filesystem: {
          readPaths: ["{{workspacePath}}/**"],
          writePaths: ["{{workspacePath}}/output/**"],
        },
        capabilityBinding: { capabilityId: "resume-screening", autoCreate: true },
      },
    })
    expect(a.spec.mode).toBe("subagent")
    expect(a.spec.capabilityBinding?.capabilityId).toBe("resume-screening")
  })

  it("rejects agent with basePrompt < 50 chars", () => {
    expectFail(AgentManifest, {
      ...minAgent,
      spec: { ...minAgent.spec, basePrompt: "too short" },
    })
  })

  it("rejects agent with invalid mode", () => {
    expectFail(AgentManifest, {
      ...minAgent,
      spec: { ...minAgent.spec, mode: "all" },
    })
  })

  it("rejects agent with permission action out of enum", () => {
    expectFail(AgentManifest, {
      ...minAgent,
      spec: {
        ...minAgent.spec,
        permission: [
          { permission: "read", pattern: "*", action: "maybe" },
        ],
      },
    })
  })

  it("rejects agent with wrong kind", () => {
    expectFail(AgentManifest, { ...minAgent, kind: "Skill" })
  })

  it("rejects agent without tools.allowed", () => {
    expectFail(AgentManifest, {
      ...minAgent,
      spec: {
        mode: "primary",
        basePrompt: minAgent.spec.basePrompt,
        tools: {},
      },
    })
  })
})

// ─── Skill ───────────────────────────────────────────────────────────

const minSkill = {
  apiVersion: API_VERSION_V1,
  kind: KIND.skill,
  metadata: { ...goodMeta, name: "tech-stack-detector" },
  spec: {
    requiredTools: ["read_file"],
  },
}

describe("SkillManifest", () => {
  it("accepts the minimum-valid skill", () => {
    const s = decode(SkillManifest, minSkill)
    expect(s.metadata.name).toBe("tech-stack-detector")
    expect(s.spec.requiredTools).toEqual(["read_file"])
    expect(s.body).toBeUndefined()
  })

  it("accepts a fully-specified skill with body", () => {
    const s = decode(SkillManifest, {
      ...minSkill,
      spec: {
        applicableAgents: ["screener"],
        applicableCapabilities: ["resume-screening"],
        requiredTools: ["read_file", "parse_resume_batch"],
        requiredSkills: [],
        resources: ["prompts/nodejs.md"],
        inputs: [{ key: "resumeText", type: "string", required: true }],
        outputs: { schema: '{"stack": ["string"]}' },
        loadStrategy: "lazy",
        triggerKeywords: ["技术栈", "tech stack"],
      },
      body: "# Tech Stack Skill\nIdentify technologies in resumes.",
    })
    expect(s.body).toContain("Tech Stack Skill")
    expect(s.spec.loadStrategy).toBe("lazy")
  })

  it("rejects skill missing requiredTools", () => {
    expectFail(SkillManifest, { ...minSkill, spec: {} })
  })

  it("rejects skill with invalid loadStrategy", () => {
    expectFail(SkillManifest, {
      ...minSkill,
      spec: { ...minSkill.spec, loadStrategy: "manual" },
    })
  })
})

// ─── Capability ──────────────────────────────────────────────────────

const minCapability = {
  apiVersion: API_VERSION_V1,
  kind: KIND.capability,
  metadata: { ...goodMeta, name: "resume-screening" },
  spec: {
    agentName: "screener",
    category: "hr-screening",
    contextKeys: ["workspacePath", "jdContent"],
  },
}

describe("CapabilityManifest", () => {
  it("accepts the minimum-valid capability", () => {
    const c = decode(CapabilityManifest, minCapability)
    expect(c.spec.agentName).toBe("screener")
    expect(c.spec.contextKeys).toEqual(["workspacePath", "jdContent"])
  })

  it("accepts a fully-specified capability", () => {
    const c = decode(CapabilityManifest, {
      ...minCapability,
      spec: {
        ...minCapability.spec,
        order: 10,
        badge: "NEW",
        color: "#1890ff",
        entryPrompt: "我是简历筛选助手",
        quickReplies: ["开始筛选", "查看历史"],
        inputSchema: [
          { key: "experienceYears", label: "年限", type: "number", default: 0 },
          {
            key: "education",
            label: "学历",
            type: "select",
            options: ["不限", "本科", "硕士"],
          },
        ],
        visibility: {
          enabled: true,
          requiredFeatureFlags: [],
          requiredRoles: [],
        },
      },
    })
    expect(c.spec.order).toBe(10)
    expect(c.spec.inputSchema).toHaveLength(2)
  })

  it("rejects capability with invalid category", () => {
    expectFail(CapabilityManifest, {
      ...minCapability,
      spec: { ...minCapability.spec, category: "unknown" },
    })
  })

  it("rejects capability missing contextKeys", () => {
    expectFail(CapabilityManifest, {
      ...minCapability,
      spec: {
        agentName: "screener",
        category: "hr-screening",
      },
    })
  })

  it("rejects capability with invalid agentName format", () => {
    expectFail(CapabilityManifest, {
      ...minCapability,
      spec: { ...minCapability.spec, agentName: "BAD-NAME" },
    })
  })
})

// ─── Discriminated union typing ──────────────────────────────────────

describe("AnyManifest narrowing", () => {
  it("narrows by kind", () => {
    const m: AnyManifest = decode(AgentManifest, minAgent) as AgentManifest
    if (m.kind === "Agent") {
      expect(m.spec.mode).toMatch(/primary|subagent/)
    } else {
      throw new Error("expected Agent")
    }
  })
})
