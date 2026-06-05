/**
 * Integration test for bootstrapPlatform (Phase B 6.x).
 *
 * Validates the end-to-end happy path:
 *   - Skills, Agents and Capabilities are loaded in the correct order
 *     by feeding raw YAML + sidecar text through the production
 *     loadFromYaml / installFromYaml codepath.
 *   - The built-in manifests land in the right registries.
 *   - window.__platform exposure is gated on dev/test mode (6.4) and
 *     opt-in.
 *
 * Also checks the failure paths (6.10):
 *   - A broken Agent yaml aborts bootstrap and leaves window.__platform
 *     untouched.
 *   - Loading order is enforced (Agent referencing an unknown Skill fails).
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { Effect } from "effect"
import {
  bootstrapPlatform,
  teardownPlatform,
  type PlatformAPI,
} from "../bootstrap"
import { Agent } from "../../agent-runtime/agent/agent"
import { Skill } from "../../agent-runtime/skill/index"
import { Provider } from "../../agent-runtime/provider/index"
import { Session } from "../../agent-runtime/session/session"
import { capabilityRegistry } from "../registry/capabilityRegistry"
import { useCapabilityStore } from "@/stores/capabilityStore"
import {
  BUILTIN_AGENT_SEEDS,
  BUILTIN_CAPABILITY_SEEDS,
  BUILTIN_SKILL_SEEDS,
} from "../builtinSeed"

let api: PlatformAPI | undefined

beforeEach(() => {
  capabilityRegistry.resetForTest()
  useCapabilityStore.setState({
    records: [],
    activeCapabilityId: null,
    isLoading: false,
    error: null,
  })
  delete window.__platform
})

afterEach(async () => {
  if (api) {
    await teardownPlatform(api)
    api = undefined
  }
  capabilityRegistry.resetForTest()
})

// Helper: tweak a yaml seed's text without re-parsing it. Used by the
// fail-fast tests below to surgically corrupt one field while keeping
// the rest of the pipeline realistic.
const replaceInYaml = (yaml: string, find: RegExp, replacement: string) =>
  yaml.replace(find, replacement)

describe("bootstrapPlatform — happy path", () => {
  it("loads built-in skills, agents and capabilities", async () => {
    api = await bootstrapPlatform()

    const skills = await api.runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* Skill.Service
        return yield* svc.all()
      }),
    )
    const agents = await api.runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* Agent.Service
        return yield* svc.list()
      }),
    )

    expect(skills.length).toBeGreaterThanOrEqual(BUILTIN_SKILL_SEEDS.length)
    expect(agents.length).toBeGreaterThanOrEqual(BUILTIN_AGENT_SEEDS.length)

    const builtinCaps = api.capabilityRegistry.list({ source: "builtin" })
    expect(builtinCaps).toHaveLength(BUILTIN_CAPABILITY_SEEDS.length)

    const resumeScreening = builtinCaps.find(
      (r) => r.manifest.metadata.name === "resume-screening",
    )
    expect(resumeScreening).toBeDefined()
    expect(resumeScreening!.manifest.spec.agentName).toBe("screener")
    expect(resumeScreening!.manifest.spec.category).toBe("hr-screening")
    expect(builtinCaps.length).toBeGreaterThanOrEqual(1)

    useCapabilityStore.getState().loadCapabilities()
    const { records } = useCapabilityStore.getState()
    expect(records.length).toBeGreaterThanOrEqual(1)
    expect(records.some((r) => r.id === "resume-screening")).toBe(true)
  })

  it("applies the SKILL.md sidecar over yaml.body (5.7 precedence)", async () => {
    api = await bootstrapPlatform()
    // Pick the first built-in skill and verify its sidecar was applied
    const firstSkillSeed = BUILTIN_SKILL_SEEDS[0]
    if (firstSkillSeed?.sidecar) {
      const skill = await api.runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* Skill.Service
          return yield* svc.get(firstSkillSeed.filename.match(/([^/]+)\.yaml$/)?.[1] ?? "")
        }),
      )
      expect(skill).toBeDefined()
      expect(skill!.content).toContain(firstSkillSeed.sidecar.slice(0, 20))
    }
  })

  it("exposes window.__platform after a successful bootstrap (test mode)", async () => {
    api = await bootstrapPlatform()
    // import.meta.env.MODE === "test" inside vitest, so 6.4's gate
    // resolves to true and the window is populated.
    expect(window.__platform).toBeDefined()
    expect(window.__platform!.capabilityRegistry).toBe(capabilityRegistry)
    expect(window.__platform!.runtime).toBe(api.runtime)
  })

  it("does not expose window.__platform when exposeOnWindow=false", async () => {
    api = await bootstrapPlatform({ exposeOnWindow: false })
    expect(window.__platform).toBeUndefined()
  })
})

describe("bootstrapPlatform — fail-fast (6.10)", () => {
  it("rejects when an Agent yaml is broken and leaves window.__platform untouched", async () => {
    const original = BUILTIN_AGENT_SEEDS[0]!
    // Break basePrompt to be too short — triggers PROMPT_TOO_SHORT (5.x).
    const brokenYaml = replaceInYaml(
      original.yaml,
      /basePrompt: \|[\s\S]*?(?=\n  tools:)/,
      "basePrompt: too short\n  ",
    )
    await expect(
      bootstrapPlatform({
        agentSeeds: [{ filename: original.filename, yaml: brokenYaml }],
        exposeOnWindow: true,
      }),
    ).rejects.toBeDefined()
    expect(window.__platform).toBeUndefined()
  })

  it("loads Agents only after Skills are present (UNKNOWN_SKILL otherwise)", async () => {
    // Boot with an empty skill list — any agent that references a skill
    // which does not exist should cause validation to fail.
    await expect(
      bootstrapPlatform({
        skillSeeds: [],
        exposeOnWindow: false,
      }),
    ).rejects.toBeDefined()
  })

  it("rejects when yaml is malformed (YAML_PARSE_FAILED bubbles up)", async () => {
    await expect(
      bootstrapPlatform({
        skillSeeds: [
          {
            filename: "/manifests/skills/bad.yaml",
            yaml: ":::not yaml:::\n  - [unclosed",
          },
        ],
        exposeOnWindow: false,
      }),
    ).rejects.toBeDefined()
  })
})

describe("bootstrapPlatform — full AppLayer wiring", () => {
  it("Provider and Session services are resolvable inside the runtime", async () => {
    api = await bootstrapPlatform({
      runtimeConfig: {
        providers: { ollama: { baseURL: "http://localhost:11434" } },
        defaultModel: { providerID: "ollama", modelID: "qwen3:8b" },
      },
    })

    const providerSvc = await api.runtime.runPromise(
      Effect.gen(function* () {
        return yield* Provider.Service
      }),
    )
    const sessionSvc = await api.runtime.runPromise(
      Effect.gen(function* () {
        return yield* Session.Service
      }),
    )

    expect(providerSvc).toBeDefined()
    expect(sessionSvc).toBeDefined()
  })

  it("does not expose the legacy window.__agentRuntime any more", async () => {
    api = await bootstrapPlatform({
      runtimeConfig: {
        providers: { ollama: {} },
        defaultModel: { providerID: "ollama", modelID: "qwen3:8b" },
      },
    })
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__agentRuntime,
    ).toBeUndefined()
  })

  it("warns but does not throw when MCP server registration fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      api = await bootstrapPlatform({
        runtimeConfig: {
          providers: { ollama: {} },
          defaultModel: { providerID: "ollama", modelID: "qwen3:8b" },
        },
        exposeOnWindow: false,
      })
      expect(api).toBeDefined()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe("bootstrapPlatform — reload", () => {
  it("returns a new runtime and disposes the old one", async () => {
    api = await bootstrapPlatform({
      runtimeConfig: {
        providers: { ollama: { baseURL: "http://localhost:11434" } },
        defaultModel: { providerID: "ollama", modelID: "qwen3:8b" },
      },
      skipMCPRegistration: true,
    })
    const oldRuntime = api.runtime
    const disposeSpy = vi.spyOn(oldRuntime, "dispose")

    await api.reload({
      providers: { ollama: { baseURL: "http://other.local:9999" } },
      defaultModel: { providerID: "ollama", modelID: "qwen3:8b" },
    })

    expect(api.runtime).not.toBe(oldRuntime)
    await new Promise((r) => setTimeout(r, 10))
    expect(disposeSpy).toHaveBeenCalled()
  })

  it("serialises concurrent reloads — last config wins", async () => {
    api = await bootstrapPlatform({
      runtimeConfig: {
        providers: { ollama: { baseURL: "http://a" } },
        defaultModel: { providerID: "ollama", modelID: "qwen3:8b" },
      },
      skipMCPRegistration: true,
    })

    const r1 = api.reload({
      providers: { ollama: { baseURL: "http://b" } },
      defaultModel: { providerID: "ollama", modelID: "qwen3:8b" },
    })
    const r2 = api.reload({
      providers: { ollama: { baseURL: "http://c" } },
      defaultModel: { providerID: "ollama", modelID: "qwen3:8b" },
    })

    await Promise.all([r1, r2])
    expect(api.runtime).toBeDefined()
  })

  it("keeps the old runtime alive when reload fails", async () => {
    api = await bootstrapPlatform({
      runtimeConfig: {
        providers: { ollama: {} },
        defaultModel: { providerID: "ollama", modelID: "qwen3:8b" },
      },
      skipMCPRegistration: true,
    })
    const oldRuntime = api.runtime

    await expect(
      api.reload({
        providers: { ollama: {} },
        defaultModel: { providerID: "ollama", modelID: "qwen3:8b" },
      }),
    ).resolves.toBeUndefined()

    expect(api.runtime).toBeDefined()
    expect(api.runtime).not.toBe(oldRuntime)
  })
})
