/**
 * Tests for CapabilityRegistry.
 *
 * Coverage goal: ≥ 90%.
 * Cases (8+):
 *   1. install success — record/enabled/installedAt invariants
 *   2. install duplicate → DUPLICATE_NAME
 *   3. install with AGENT_NOT_FOUND — pollution-free
 *   4. uninstall builtin → throws "Cannot uninstall builtin"
 *   5. uninstall user → success
 *   6. disable / enable round-trip
 *   7. list ordering (order asc, then name asc)
 *   8. list filter by source / enabled
 *   9. subscribe receives events; unsub silences them
 */

import { beforeEach, describe, it, expect } from "vitest"
import { capabilityRegistry, type Listener } from "./capabilityRegistry"
import { API_VERSION_V1, KIND, type CapabilityManifest } from "../hsas/schema"

const meta = (
  name: string,
  source: "builtin" | "user" | "marketplace" = "builtin",
) => ({
  name,
  displayName: `Capability ${name}`,
  description: `${name} entry-point card`,
  source,
  version: "1.0.0",
  createdAt: "2026-05-27T10:00:00Z",
})

const makeCapability = (
  name: string,
  source: "builtin" | "user" | "marketplace" = "builtin",
  order?: number,
  agentName: string = "screener",
): CapabilityManifest => ({
  apiVersion: API_VERSION_V1,
  kind: KIND.capability,
  metadata: meta(name, source),
  spec: {
    agentName,
    category: "hr-screening",
    // Task 1.4: needsWorkspace must be explicitly declared
    needsWorkspace: false,
    contextKeys: ["workspacePath"],
    ...(order !== undefined ? { order } : {}),
  },
})

beforeEach(() => {
  capabilityRegistry.resetForTest()
})

// ─── install / get ───────────────────────────────────────────────────

describe("install", () => {
  it("registers a capability with enabled=true and installedAt within ±1s", () => {
    const m = makeCapability("resume-screening")
    const before = Date.now()
    const rec = capabilityRegistry.install(m)
    const after = Date.now()

    // Validator returns a re-encoded value, so we use deep-equal not reference.
    expect(rec.manifest).toEqual(m)
    expect(rec.enabled).toBe(true)
    expect(rec.installedAt).toBeGreaterThanOrEqual(before)
    expect(rec.installedAt).toBeLessThanOrEqual(after)

    expect(capabilityRegistry.get("resume-screening")?.manifest).toEqual(m)
  })

  it("rejects duplicate install", () => {
    const m = makeCapability("resume-screening")
    capabilityRegistry.install(m)
    expect(() => capabilityRegistry.install(makeCapability("resume-screening"))).toThrow(
      /DUPLICATE_NAME/,
    )
  })

  it("does not pollute the registry when AGENT_NOT_FOUND is raised", () => {
    expect(() =>
      capabilityRegistry.install(makeCapability("resume-screening", "builtin", 0, "ghost-agent"), {
        validationContext: {
          agentExists: () => false,
          knownContextKeys: new Set(["workspacePath"]),
        },
      }),
    ).toThrow(/AGENT_NOT_FOUND/)
    expect(capabilityRegistry.get("resume-screening")).toBeUndefined()
  })

  it("rejects when kind is wrong", () => {
    const wrong = { ...makeCapability("any-name"), kind: "Agent" }
    expect(() => capabilityRegistry.install(wrong)).toThrow()
    expect(capabilityRegistry.get("any-name")).toBeUndefined()
  })
})

// ─── uninstall / disable ─────────────────────────────────────────────

describe("uninstall / enable / disable", () => {
  it("rejects uninstalling a builtin capability", () => {
    capabilityRegistry.install(makeCapability("resume-screening", "builtin"))
    expect(() => capabilityRegistry.uninstall("resume-screening")).toThrow(
      /Cannot uninstall builtin/,
    )
    expect(capabilityRegistry.get("resume-screening")).toBeDefined()
  })

  it("succeeds uninstalling a user capability", () => {
    capabilityRegistry.install(makeCapability("custom-flow", "user"))
    capabilityRegistry.uninstall("custom-flow")
    expect(capabilityRegistry.get("custom-flow")).toBeUndefined()
  })

  it("disable then enable a builtin capability", () => {
    capabilityRegistry.install(makeCapability("resume-screening", "builtin"))
    const disabled = capabilityRegistry.disable("resume-screening")
    expect(disabled.enabled).toBe(false)
    expect(capabilityRegistry.list({ enabled: true })).toHaveLength(0)
    const enabled = capabilityRegistry.enable("resume-screening")
    expect(enabled.enabled).toBe(true)
  })

  it("disable / enable on a non-existent capability throws", () => {
    expect(() => capabilityRegistry.disable("ghost")).toThrow()
    expect(() => capabilityRegistry.enable("ghost")).toThrow()
  })

  it("uninstall on a non-existent capability throws", () => {
    expect(() => capabilityRegistry.uninstall("ghost")).toThrow()
  })
})

// ─── list ────────────────────────────────────────────────────────────

describe("list", () => {
  it("orders by spec.order asc, then by name", () => {
    capabilityRegistry.install(makeCapability("alpha-cap", "builtin", 10))
    capabilityRegistry.install(makeCapability("bravo-cap", "builtin", 5))
    capabilityRegistry.install(makeCapability("charlie-cap", "builtin")) // order=undefined → 999
    const ordered = capabilityRegistry.list().map((r) => r.manifest.metadata.name)
    expect(ordered).toEqual(["bravo-cap", "alpha-cap", "charlie-cap"])
  })

  it("uses name as a tiebreaker when order is equal", () => {
    capabilityRegistry.install(makeCapability("zulu-cap", "builtin", 5))
    capabilityRegistry.install(makeCapability("alpha-cap", "builtin", 5))
    const ordered = capabilityRegistry.list().map((r) => r.manifest.metadata.name)
    expect(ordered).toEqual(["alpha-cap", "zulu-cap"])
  })

  it("filters by source and enabled", () => {
    capabilityRegistry.install(makeCapability("alpha-cap", "builtin", 1))
    capabilityRegistry.install(makeCapability("bravo-cap", "user", 2))
    capabilityRegistry.disable("alpha-cap")
    expect(capabilityRegistry.list({ source: "builtin" }).map((r) => r.manifest.metadata.name)).toEqual([
      "alpha-cap",
    ])
    expect(capabilityRegistry.list({ enabled: false })).toHaveLength(1)
    expect(capabilityRegistry.list({ enabled: true }).map((r) => r.manifest.metadata.name)).toEqual([
      "bravo-cap",
    ])
  })
})

// ─── subscribe ───────────────────────────────────────────────────────

describe("subscribe", () => {
  it("receives install / disable / enable / uninstall events", () => {
    const events: Array<[string, string]> = []
    const listener: Listener = ({ action, record }) => {
      events.push([record.manifest.metadata.name, action])
    }
    capabilityRegistry.subscribe(listener)

    capabilityRegistry.install(makeCapability("alpha-cap", "user", 1))
    capabilityRegistry.disable("alpha-cap")
    capabilityRegistry.enable("alpha-cap")
    capabilityRegistry.uninstall("alpha-cap")

    expect(events).toEqual([
      ["alpha-cap", "install"],
      ["alpha-cap", "disable"],
      ["alpha-cap", "enable"],
      ["alpha-cap", "uninstall"],
    ])
  })

  it("returns an unsubscribe function that silences future events", () => {
    const seen: string[] = []
    const unsub = capabilityRegistry.subscribe(({ action, record }) => {
      seen.push(`${record.manifest.metadata.name}:${action}`)
    })
    capabilityRegistry.install(makeCapability("first", "user", 1))
    unsub()
    capabilityRegistry.install(makeCapability("second", "user", 2))
    expect(seen).toEqual(["first:install"])
  })

  it("isolates listener errors", () => {
    capabilityRegistry.subscribe(() => {
      throw new Error("boom")
    })
    expect(() => capabilityRegistry.install(makeCapability("safe", "user", 1))).not.toThrow()
  })
})

// ─── 5.5 increment: installFromYaml & hoisted source ─────────────────

describe("installFromYaml", () => {
  const yamlOk = `apiVersion: hsas.seven-hrops/v1
kind: Capability
metadata:
  name: yaml-cap
  displayName: YAML Cap
  description: from yaml fixture
  source: user
  version: 1.0.0
  createdAt: "2026-05-27T10:00:00Z"
spec:
  agentName: screener
  category: hr-screening
  needsWorkspace: false
  contextKeys:
    - workspacePath
  order: 3
`

  it("parses yaml and installs the capability", () => {
    const rec = capabilityRegistry.installFromYaml(yamlOk)
    expect(rec.manifest.metadata.name).toBe("yaml-cap")
    expect(rec.manifest.spec.order).toBe(3)
    expect(capabilityRegistry.get("yaml-cap")).toBe(rec)
  })

  it("throws YAML_PARSE_FAILED on malformed yaml", () => {
    const bad = "::: not yaml:::\n  - [unclosed"
    expect(() => capabilityRegistry.installFromYaml(bad)).toThrow(/YAML_PARSE_FAILED/)
  })

  it("keeps registry untouched when yaml parse fails (no pollution)", () => {
    const before = capabilityRegistry.list().length
    expect(() => capabilityRegistry.installFromYaml(":::bad")).toThrow()
    expect(capabilityRegistry.list().length).toBe(before)
  })
})

describe("record.source (5.5 hoisted field)", () => {
  it("mirrors manifest.metadata.source on the record top-level", () => {
    const rec = capabilityRegistry.install(makeCapability("hoist-test", "marketplace", 1))
    expect(rec.source).toBe("marketplace")
    expect(rec.source).toBe(rec.manifest.metadata.source)
  })

  it("propagates through enable/disable transitions", () => {
    capabilityRegistry.install(makeCapability("transition-test", "user", 1))
    const after = capabilityRegistry.disable("transition-test")
    expect(after.source).toBe("user")
    const back = capabilityRegistry.enable("transition-test")
    expect(back.source).toBe("user")
  })
})
