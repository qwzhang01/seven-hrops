/**
 * Tests for SkillLoader.
 *
 * Covers: manifestToSkillInfo + load + loadMany + unload + ValidationError
 * surface. Uses a fresh `Skill.defaultLayer` runtime per describe block to
 * avoid cross-test contamination.
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest"
import { Effect, ManagedRuntime } from "effect"
import { Skill } from "../../agent-runtime/skill/index"
import { skillLoader, manifestToSkillInfo } from "./skillLoader"
import { API_VERSION_V1, KIND, type SkillManifest } from "../hsas/schema"
import { toolRegistry, type ToolMeta } from "../registry/toolRegistry"

// Phase B: toolRegistry is empty by default in tests. Seed `read_file` so
// `manifestValidator.checkSkill` (which checks `requiredTools` against
// `toolExists`) accepts the fixture manifests below.
const readFileMeta: ToolMeta = {
  name: "read_file",
  category: "safe",
  riskLevel: "low",
  description: "fixture",
  defaultAllowedSources: ["builtin", "user", "marketplace"],
  requireApproval: false,
}

beforeAll(() => {
  toolRegistry.registerForTest(readFileMeta)
})

afterAll(() => {
  toolRegistry.unregisterForTest("read_file")
})

const goodMeta = {
  name: "tech-stack-detector",
  displayName: "技术栈识别",
  description: "Identify the technology stack of a candidate from their resume.",
  source: "builtin" as const,
  version: "1.0.0",
  createdAt: "2026-05-27T10:00:00Z",
}

const goodSkill: SkillManifest = {
  apiVersion: API_VERSION_V1,
  kind: KIND.skill,
  metadata: goodMeta,
  spec: { requiredTools: ["read_file"] },
  body: "# Tech Stack\nDetect Node / Java / Go.",
}

describe("manifestToSkillInfo", () => {
  it("maps metadata to Info", () => {
    const info = manifestToSkillInfo(goodSkill)
    expect(info.name).toBe("tech-stack-detector")
    expect(info.description).toContain("technology stack")
    expect(info.content).toContain("Detect Node")
  })

  it("defaults content to empty string when body is missing", () => {
    const info = manifestToSkillInfo({ ...goodSkill, body: undefined })
    expect(info.content).toBe("")
  })
})

describe("skillLoader.load", () => {
  const rt = ManagedRuntime.make(Skill.defaultLayer)

  it("loads a valid manifest into Skill.Service", async () => {
    const info = await rt.runPromise(skillLoader.load(goodSkill))
    expect(info.name).toBe("tech-stack-detector")

    const fetched = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* Skill.Service
        return yield* svc.get("tech-stack-detector")
      }),
    )
    expect(fetched).toBeDefined()
    expect(fetched!.content).toContain("Tech Stack")
  })

  it("rejects when kind is wrong", async () => {
    const exit = await rt.runPromiseExit(
      skillLoader.load({ ...goodSkill, kind: "Agent" }),
    )
    expect(exit._tag).toBe("Failure")
  })

  it("rejects when requiredTools references a sensitive tool from a user source", async () => {
    const m = {
      ...goodSkill,
      metadata: { ...goodMeta, name: "evil-skill", source: "user" as const },
      spec: { requiredTools: ["delete_resume"] },
    }
    const exit = await rt.runPromiseExit(skillLoader.load(m))
    expect(exit._tag).toBe("Failure")
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

describe("skillLoader.loadMany / unload", () => {
  const rt = ManagedRuntime.make(Skill.defaultLayer)

  it("loads multiple manifests in order", async () => {
    const m2: SkillManifest = {
      ...goodSkill,
      metadata: { ...goodMeta, name: "jd-keyword-matcher" },
      body: "# Match\n",
    }
    const infos = await rt.runPromise(skillLoader.loadMany([goodSkill, m2]))
    expect(infos.map((i) => i.name)).toEqual(["tech-stack-detector", "jd-keyword-matcher"])
  })

  it("unload removes a skill from the registry", async () => {
    // The previous loadMany test already loaded "tech-stack-detector"; just unload it.
    await rt.runPromise(skillLoader.unload("tech-stack-detector"))
    const fetched = await rt.runPromise(
      Effect.gen(function* () {
        const svc = yield* Skill.Service
        return yield* svc.get("tech-stack-detector")
      }),
    )
    expect(fetched).toBeUndefined()
  })

  afterAll(async () => {
    await rt.dispose()
  })
})

// ─── 5.7 increment: loadFromYaml + sidecar precedence ────────────────

describe("skillLoader.loadFromYaml", () => {
  const rt = ManagedRuntime.make(Skill.defaultLayer)

  const yamlText = `apiVersion: hsas.seven-hrops/v1
kind: Skill
metadata:
  name: yaml-skill
  displayName: YAML Skill
  description: loaded from yaml fixture
  source: builtin
  version: 1.0.0
  createdAt: "2026-05-27T10:00:00Z"
spec:
  requiredTools:
    - read_file
body: |
  # Inline body
  fallback content from yaml.body
`

  it("uses yaml.body when no sidecar is supplied", async () => {
    const info = await rt.runPromise(skillLoader.loadFromYaml(yamlText))
    expect(info.name).toBe("yaml-skill")
    expect(info.content).toContain("fallback content")
  })

  it("sidecar overrides yaml.body (5.7 precedence rule)", async () => {
    const sidecar = "# Markdown sidecar\nthis wins over yaml.body"
    // Reload fresh to avoid name collision with the previous test.
    await rt.runPromise(skillLoader.unload("yaml-skill"))
    const info = await rt.runPromise(skillLoader.loadFromYaml(yamlText, sidecar))
    expect(info.content).toBe(sidecar)
    expect(info.content).not.toContain("fallback content")
  })

  it("throws YAML_PARSE_FAILED on malformed yaml", async () => {
    const exit = await rt.runPromiseExit(
      skillLoader.loadFromYaml(":::not yaml:::\n  - [unclosed"),
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
