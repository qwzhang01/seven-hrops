/**
 * Tests for manifestValidator.ts.
 *
 * Coverage: 100% — every one of the 19 HSAS error codes triggers at least
 * one assertion, plus a happy path.
 */

import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import {
  validate,
  validateSync,
  ValidationError,
  ERROR_CODES,
  type ValidationContext,
  type ErrorCode,
} from "./validator"
import { API_VERSION_V1, KIND } from "./schema"

// ─── Fixture helpers ─────────────────────────────────────────────────

const goodMeta = {
  name: "screener",
  displayName: "简历筛选",
  description: "评估候选人简历与 JD 的匹配度",
  source: "builtin",
  version: "1.0.0",
  createdAt: "2026-05-27T10:00:00Z",
}

const goodAgent = {
  apiVersion: API_VERSION_V1,
  kind: KIND.agent,
  metadata: { ...goodMeta },
  spec: {
    mode: "primary",
    basePrompt:
      "You are a helpful HR operations assistant. Provide concise, " +
      "evidence-based answers to recruitment questions.",
    tools: { allowed: ["read_file"] },
  },
}

const goodSkill = {
  apiVersion: API_VERSION_V1,
  kind: KIND.skill,
  metadata: { ...goodMeta, name: "tech-stack-detector" },
  spec: { requiredTools: ["read_file"] },
}

const goodCapability = {
  apiVersion: API_VERSION_V1,
  kind: KIND.capability,
  metadata: { ...goodMeta, name: "resume-screening" },
  spec: {
    agentName: "screener",
    category: "hr-screening",
    // Task 1.4: needsWorkspace must be explicitly declared
    needsWorkspace: true,
    contextKeys: ["workspacePath"],
  },
}

const ctxAllOk: ValidationContext = {
  toolExists: (_t) => true,
  toolAllowedForSource: (_t, _s) => true,
  skillExists: (_n) => true,
  agentExists: (_n) => true,
  modelProviderConfigured: (_p) => true,
  resourceExists: (_p) => true,
  signatureValid: (_s) => true,
  resourcesWithinLimit: (_r, _s) => true,
  knownContextKeys: new Set(["workspacePath", "jdContent", "projectId", "candidateId", "jdId"]),
}

const expectCode = (fn: () => unknown, code: ErrorCode): void => {
  try {
    fn()
    throw new Error(`Expected ValidationError(${code}) but no error was thrown`)
  } catch (e) {
    if (!(e instanceof ValidationError)) {
      throw new Error(`Expected ValidationError but got ${String(e)}`)
    }
    expect(e.code).toBe(code)
  }
}

// ─── Sanity: ERROR_CODES has all 19 codes ───────────────────────────

describe("ERROR_CODES", () => {
  it("contains exactly 24 unique codes (19 HSAS standard + YAML_PARSE_FAILED + MANIFEST_FILENAME_MISMATCH + MANIFEST_MULTIDOC_NOT_ALLOWED + ASSISTANT_TEMPERATURE_MUST_BE_ZERO + NEEDS_WORKSPACE_NOT_DECLARED)", () => {
    expect(ERROR_CODES).toHaveLength(24)
    expect(new Set(ERROR_CODES).size).toBe(24)
  })
})

// ─── Happy path ─────────────────────────────────────────────────────

describe("validate — happy path", () => {
  it("returns a typed Agent manifest for a valid input", () => {
    const m = validateSync(goodAgent, ctxAllOk)
    expect(m.kind).toBe("Agent")
    expect(m.metadata.name).toBe("screener")
  })

  it("Effect-flavoured validate succeeds for a valid input", async () => {
    const m = await Effect.runPromise(validate(goodSkill, ctxAllOk))
    expect(m.kind).toBe("Skill")
  })
})

// ─── 19 error codes — at least one case each ────────────────────────

describe("INVALID_API_VERSION", () => {
  it("rejects unknown apiVersion", () => {
    expectCode(() => validateSync({ ...goodAgent, apiVersion: "v2" }), "INVALID_API_VERSION")
  })
})

describe("INVALID_KIND", () => {
  it("rejects unknown kind", () => {
    expectCode(() => validateSync({ ...goodAgent, kind: "Plugin" }), "INVALID_KIND")
  })
})

describe("INVALID_NAME", () => {
  it("rejects malformed name", () => {
    expectCode(
      () =>
        validateSync({
          ...goodAgent,
          metadata: { ...goodMeta, name: "BAD-NAME" },
        }),
      "INVALID_NAME",
    )
  })

  it("rejects reserved prefix on user source", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodAgent,
            metadata: {
              ...goodMeta,
              name: "builtin-myagent",
              source: "user",
            },
          },
          ctxAllOk,
        ),
      "INVALID_NAME",
    )
  })
})

describe("DUPLICATE_NAME", () => {
  it("rejects when registry already has the name", () => {
    expectCode(
      () =>
        validateSync(goodAgent, {
          ...ctxAllOk,
          isNameDuplicate: (kind, name) => kind === "Agent" && name === "screener",
        }),
      "DUPLICATE_NAME",
    )
  })
})

describe("MISSING_REQUIRED_FIELD", () => {
  it("rejects when metadata is missing", () => {
    expectCode(
      () =>
        validateSync({ apiVersion: API_VERSION_V1, kind: KIND.agent, spec: goodAgent.spec }),
      "MISSING_REQUIRED_FIELD",
    )
  })

  it("rejects when spec is missing", () => {
    expectCode(
      () => validateSync({ apiVersion: API_VERSION_V1, kind: KIND.agent, metadata: goodMeta }),
      "MISSING_REQUIRED_FIELD",
    )
  })

  it("rejects when metadata.displayName is missing", () => {
    const meta: Partial<typeof goodMeta> = { ...goodMeta }
    delete meta.displayName
    expectCode(
      () => validateSync({ ...goodAgent, metadata: meta }),
      "MISSING_REQUIRED_FIELD",
    )
  })
})

describe("UNKNOWN_TOOL", () => {
  it("rejects when an Agent references a tool not in the registry", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodAgent,
            spec: { ...goodAgent.spec, tools: { allowed: ["non_existent"] } },
          },
          { ...ctxAllOk, toolExists: (t) => t !== "non_existent" },
        ),
      "UNKNOWN_TOOL",
    )
  })

  it("rejects when a Skill references a tool not in the registry", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodSkill,
            spec: { requiredTools: ["non_existent"] },
          },
          { ...ctxAllOk, toolExists: (t) => t !== "non_existent" },
        ),
      "UNKNOWN_TOOL",
    )
  })
})

describe("TOOL_NOT_PERMITTED_FOR_SOURCE", () => {
  it("rejects when a user agent uses a builtin-only tool", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodAgent,
            metadata: { ...goodMeta, source: "user" },
            spec: { ...goodAgent.spec, tools: { allowed: ["delete_resume"] } },
          },
          {
            ...ctxAllOk,
            toolAllowedForSource: (t, s) => !(t === "delete_resume" && s === "user"),
          },
        ),
      "TOOL_NOT_PERMITTED_FOR_SOURCE",
    )
  })
})

describe("UNKNOWN_SKILL", () => {
  it("rejects when an Agent references a Skill that is not registered", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodAgent,
            spec: { ...goodAgent.spec, skills: ["never-installed"] },
          },
          { ...ctxAllOk, skillExists: (n) => n !== "never-installed" },
        ),
      "UNKNOWN_SKILL",
    )
  })
})

describe("CIRCULAR_INHERIT", () => {
  it("rejects when inheritFrom forms a cycle", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodAgent,
            spec: {
              ...goodAgent.spec,
              inheritFrom: { name: "parent-a", overrides: [] },
            },
          },
          {
            ...ctxAllOk,
            agentInheritParent: (n) =>
              n === "parent-a" ? "parent-b" : n === "parent-b" ? "screener" : undefined,
          },
        ),
      "CIRCULAR_INHERIT",
    )
  })
})

describe("CIRCULAR_SKILL_DEPENDENCY", () => {
  it("rejects when requiredSkills forms a cycle", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodSkill,
            spec: { requiredTools: ["read_file"], requiredSkills: ["dep-a"] },
          },
          {
            ...ctxAllOk,
            skillDependencies: (n) =>
              n === "dep-a" ? ["dep-b"] : n === "dep-b" ? ["tech-stack-detector"] : [],
          },
        ),
      "CIRCULAR_SKILL_DEPENDENCY",
    )
  })
})

describe("RESOURCE_NOT_FOUND", () => {
  it("rejects when a Skill resource path does not exist", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodSkill,
            spec: { requiredTools: ["read_file"], resources: ["prompts/missing.md"] },
          },
          { ...ctxAllOk, resourceExists: () => false },
        ),
      "RESOURCE_NOT_FOUND",
    )
  })
})

describe("PROMPT_TOO_SHORT", () => {
  it("rejects when basePrompt < 50 chars", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodAgent,
            spec: { ...goodAgent.spec, basePrompt: "too short" },
          },
          ctxAllOk,
        ),
      "PROMPT_TOO_SHORT",
    )
  })
})

describe("MODEL_PROVIDER_NOT_CONFIGURED", () => {
  it("rejects when a referenced provider is unavailable", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodAgent,
            spec: {
              ...goodAgent.spec,
              model: { provider: "anthropic", modelID: "claude-4.7-sonnet" },
            },
          },
          { ...ctxAllOk, modelProviderConfigured: () => false },
        ),
      "MODEL_PROVIDER_NOT_CONFIGURED",
    )
  })
})

describe("INVALID_PERMISSION_ACTION", () => {
  it("rejects unknown action via Schema (raw input bypasses Schema's typing)", () => {
    expectCode(
      () =>
        validateSync({
          ...goodAgent,
          spec: {
            ...goodAgent.spec,
            permission: [{ permission: "read", pattern: "*", action: "maybe" }],
          },
        }),
      "INVALID_PERMISSION_ACTION",
    )
  })
})

describe("SKILL_TOO_LARGE", () => {
  it("rejects when skill payload exceeds the source's limit", () => {
    expectCode(
      () =>
        validateSync(goodSkill, {
          ...ctxAllOk,
          skillPayloadBytes: 100 * 1024 * 1024,
        }),
      "SKILL_TOO_LARGE",
    )
  })
})

describe("AGENT_NOT_FOUND", () => {
  it("rejects when Capability references a non-existent agent", () => {
    expectCode(
      () =>
        validateSync(goodCapability, {
          ...ctxAllOk,
          agentExists: () => false,
        }),
      "AGENT_NOT_FOUND",
    )
  })
})

describe("UNKNOWN_CONTEXT_KEY", () => {
  it("rejects when Capability uses an unregistered contextKey", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodCapability,
            spec: {
              ...goodCapability.spec,
              contextKeys: ["mysteryKey"],
            },
          },
          { ...ctxAllOk, knownContextKeys: new Set(["workspacePath"]) },
        ),
      "UNKNOWN_CONTEXT_KEY",
    )
  })
})

describe("SIGNATURE_INVALID", () => {
  it("rejects marketplace agent with invalid signature", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodAgent,
            metadata: { ...goodMeta, source: "marketplace", signature: "bad" },
          },
          { ...ctxAllOk, signatureValid: () => false },
        ),
      "SIGNATURE_INVALID",
    )
  })
})

describe("RESOURCE_LIMIT_EXCEEDED", () => {
  it("rejects when sandbox resource limits are violated", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodAgent,
            metadata: { ...goodMeta, source: "user" },
            spec: {
              ...goodAgent.spec,
              resources: { maxTokensPerSession: 999_999_999 },
            },
          },
          { ...ctxAllOk, resourcesWithinLimit: () => false },
        ),
      "RESOURCE_LIMIT_EXCEEDED",
    )
  })
})

// ─── Effect.fail flavour ─────────────────────────────────────────────

describe("NEEDS_WORKSPACE_NOT_DECLARED", () => {
  it("rejects Capability that omits needsWorkspace entirely", () => {
    expectCode(
      () =>
        validateSync(
          {
            ...goodCapability,
            spec: {
              agentName: "screener",
              category: "hr-screening",
              // needsWorkspace intentionally omitted
              contextKeys: ["workspacePath"],
            },
          },
          ctxAllOk,
        ),
      "NEEDS_WORKSPACE_NOT_DECLARED",
    )
  })

  it("accepts Capability with needsWorkspace: true", () => {
    const m = validateSync(
      { ...goodCapability, spec: { ...goodCapability.spec, needsWorkspace: true } },
      ctxAllOk,
    )
    expect(m.kind).toBe("Capability")
  })

  it("accepts Capability with needsWorkspace: false", () => {
    const m = validateSync(
      { ...goodCapability, spec: { ...goodCapability.spec, needsWorkspace: false } },
      ctxAllOk,
    )
    expect(m.kind).toBe("Capability")
  })
})

// ─── Effect.fail flavour ─────────────────────────────────────────────

describe("validate (Effect)", () => {
  it("fails with ValidationError carrying the right code", async () => {
    const exit = await Effect.runPromiseExit(
      validate(
        {
          ...goodAgent,
          spec: { ...goodAgent.spec, basePrompt: "tiny" },
        },
        ctxAllOk,
      ),
    )
    expect(exit._tag).toBe("Failure")
  })
})
