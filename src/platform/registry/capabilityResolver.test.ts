/**
 * Tests for capabilityResolver.
 *
 * Spec reference:
 *   - openspec/changes/arch-capability-agent-contract/specs/capability-resolver/spec.md
 *
 * These tests prepare data through `capabilityRegistry.install` only —
 * the resolver itself is a pure function over the registry's in-memory
 * map, so no fs / yaml / fetch mocking is needed.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { capabilityRegistry } from "./capabilityRegistry"
import {
  resolveCapability,
  resolveWorkspaceNeeds,
  CapabilityNotFoundError,
  CapabilityDisabledError,
} from "./capabilityResolver"

const buildManifest = (overrides?: {
  name?: string
  agentName?: string
  contextKeys?: string[]
  displayName?: string
  needsWorkspace?: boolean
}) => ({
  apiVersion: "hsas.seven-hrops/v1" as const,
  kind: "Capability" as const,
  metadata: {
    name: overrides?.name ?? "resume-screening",
    displayName: overrides?.displayName ?? "简历筛选",
    description: "Screen candidate resumes against a JD",
    source: "builtin" as const,
    version: "1.0.0",
    createdAt: "2026-05-29T00:00:00Z",
  },
  spec: {
    agentName: overrides?.agentName ?? "screener",
    category: "hr-screening",
    // Task 1.4: needsWorkspace must be explicitly declared; default to true
    // for resume-screening (a workspace-requiring capability).
    needsWorkspace: overrides?.needsWorkspace ?? true,
    contextKeys: overrides?.contextKeys ?? ["workspacePath", "jdContent"],
  },
})

beforeEach(() => {
  capabilityRegistry.resetForTest()
})

describe("resolveCapability — happy path", () => {
  it("returns a ResolvedCapability for an installed enabled capability", () => {
    capabilityRegistry.install(buildManifest())

    const r = resolveCapability("resume-screening")
    expect(r.capabilityId).toBe("resume-screening")
    expect(r.agentName).toBe("screener")
    expect(r.displayName).toBe("简历筛选")
    expect(r.source).toBe("builtin")
    expect(r.contextKeys).toEqual(["workspacePath", "jdContent"])
    expect(r.manifest.metadata.name).toBe("resume-screening")
    expect(r.record.id).toBe("resume-screening")
    expect(r.record.enabled).toBe(true)
  })

  it("needsWorkspace defaults to false when declared as false in manifest", () => {
    capabilityRegistry.install(buildManifest({ needsWorkspace: false }))
    const r = resolveCapability("resume-screening")
    expect(r.needsWorkspace).toBe(false)
  })

  it("needsWorkspace is true when declared as true in manifest", () => {
    capabilityRegistry.install(buildManifest({ needsWorkspace: true }))
    const r = resolveCapability("resume-screening")
    expect(r.needsWorkspace).toBe(true)
  })

  it("agentName is a non-undefined string at the type level (compile-time check)", () => {
    capabilityRegistry.install(buildManifest({ agentName: "screener" }))
    const r = resolveCapability("resume-screening")
    // If ResolvedCapability.agentName were `string | undefined` this line
    // would fail to type-check (`r.agentName.toLowerCase()`).
    expect(r.agentName.toLowerCase()).toBe("screener")
  })
})

describe("resolveCapability — failure modes", () => {
  it("throws CapabilityNotFoundError when the id is unknown", () => {
    expect(() => resolveCapability("nonexistent-cap")).toThrow(
      CapabilityNotFoundError,
    )
    try {
      resolveCapability("nonexistent-cap")
    } catch (err) {
      expect(err).toBeInstanceOf(CapabilityNotFoundError)
      expect((err as CapabilityNotFoundError).capabilityId).toBe(
        "nonexistent-cap",
      )
      expect((err as Error).message).toContain("nonexistent-cap")
    }
  })

  it("throws CapabilityDisabledError when the capability is disabled", () => {
    capabilityRegistry.install(buildManifest())
    capabilityRegistry.disable("resume-screening")

    expect(() => resolveCapability("resume-screening")).toThrow(
      CapabilityDisabledError,
    )
    try {
      resolveCapability("resume-screening")
    } catch (err) {
      expect(err).toBeInstanceOf(CapabilityDisabledError)
      expect((err as CapabilityDisabledError).capabilityId).toBe(
        "resume-screening",
      )
      expect((err as CapabilityDisabledError).displayName).toBe("简历筛选")
    }
  })

  it("throws CapabilityNotFoundError for empty string", () => {
    expect(() => resolveCapability("")).toThrow(CapabilityNotFoundError)
  })

  it("throws CapabilityNotFoundError for undefined (runtime safety net)", () => {
    expect(() =>
      resolveCapability(undefined as unknown as string),
    ).toThrow(CapabilityNotFoundError)
  })
})

describe("resolveCapability — bootstrap integration", () => {
  // Mirrors `bootstrap.integration.test.ts` indirectly: once
  // `resume-screening` is installed by bootstrap, resolveCapability
  // must produce `agentName === "screener"` without any extra setup.
  it("matches the bootstrap-installed resume-screening capability", () => {
    capabilityRegistry.install(buildManifest())
    const r = resolveCapability("resume-screening")
    expect(r.agentName).toBe("screener")
  })
})

describe("resolveWorkspaceNeeds", () => {
  it("returns true for a capability with needsWorkspace: true", () => {
    capabilityRegistry.install(buildManifest({ needsWorkspace: true }))
    expect(resolveWorkspaceNeeds("resume-screening")).toBe(true)
  })

  it("returns false for a capability with needsWorkspace: false", () => {
    capabilityRegistry.install(
      buildManifest({ name: "assistant", needsWorkspace: false }),
    )
    expect(resolveWorkspaceNeeds("assistant")).toBe(false)
  })

  it("returns false (default) when needsWorkspace is declared as false in manifest", () => {
    capabilityRegistry.install(buildManifest({ needsWorkspace: false })) // explicitly false
    expect(resolveWorkspaceNeeds("resume-screening")).toBe(false)
  })

  it("throws CapabilityNotFoundError for unknown capability", () => {
    expect(() => resolveWorkspaceNeeds("non-existent-cap")).toThrow(
      CapabilityNotFoundError,
    )
  })

  it("throws CapabilityDisabledError for disabled capability", () => {
    capabilityRegistry.install(buildManifest())
    capabilityRegistry.disable("resume-screening")
    expect(() => resolveWorkspaceNeeds("resume-screening")).toThrow(
      CapabilityDisabledError,
    )
  })
})
