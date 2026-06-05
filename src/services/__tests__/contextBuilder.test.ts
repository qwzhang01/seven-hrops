import { describe, it, expect, beforeEach } from "vitest"
import { renderTemplate, buildSystemPrompt } from "../contextBuilder"
import { capabilityRegistry } from "@/platform/registry/capabilityRegistry"

// ─── renderTemplate ──────────────────────────────────────────────────

describe("renderTemplate", () => {
  it("replaces known variables", () => {
    expect(
      renderTemplate({
        template: "Hello {{name}}, today is {{date}}",
        contextKeys: { name: "Seven", date: "2026-05-28" },
      }),
    ).toBe("Hello Seven, today is 2026-05-28")
  })

  it("preserves unknown variables", () => {
    expect(
      renderTemplate({
        template: "Hello {{name}} {{unknown}}",
        contextKeys: { name: "Seven" },
      }),
    ).toBe("Hello Seven {{unknown}}")
  })

  it("handles empty template", () => {
    expect(renderTemplate({ template: "", contextKeys: {} })).toBe("")
  })

  it("handles template with no placeholders", () => {
    expect(
      renderTemplate({ template: "No placeholders here", contextKeys: { x: "y" } }),
    ).toBe("No placeholders here")
  })

  it("handles empty contextKeys", () => {
    expect(
      renderTemplate({ template: "Hello {{name}}", contextKeys: {} }),
    ).toBe("Hello {{name}}")
  })

  it("replaces multiple occurrences of the same key", () => {
    expect(
      renderTemplate({
        template: "{{x}} and {{x}}",
        contextKeys: { x: "foo" },
      }),
    ).toBe("foo and foo")
  })
})

// ─── buildSystemPrompt ───────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  beforeEach(() => {
    capabilityRegistry.resetForTest()
  })

  it("returns default prompt when capabilityId is undefined", () => {
    const result = buildSystemPrompt(undefined)
    expect(result).toContain("Seven")
  })

  it("returns default prompt when capabilityId is empty string", () => {
    const result = buildSystemPrompt("")
    expect(result).toContain("Seven")
  })

  it("returns default prompt when capability is not registered", () => {
    const result = buildSystemPrompt("non-existent-capability")
    expect(result).toContain("Seven")
  })

  it("returns default prompt when capability has no entryPrompt", () => {
    capabilityRegistry.install({
      apiVersion: "hsas.seven-hrops/v1",
      kind: "Capability",
      metadata: { name: "test-cap", displayName: "test-cap", description: "test-cap card", source: "builtin", version: "1.0.0", createdAt: "2026-05-27T10:00:00Z" },
      spec: {
        agentName: "test-agent",
        category: "hr-screening",
        contextKeys: [],
        // no entryPrompt
      },
    })
    const result = buildSystemPrompt("test-cap")
    expect(result).toContain("Seven")
  })

  it("renders entryPrompt template with default context keys", () => {
    capabilityRegistry.install({
      apiVersion: "hsas.seven-hrops/v1",
      kind: "Capability",
      metadata: { name: "screener", displayName: "screener", description: "screener card", source: "builtin", version: "1.0.0", createdAt: "2026-05-27T10:00:00Z" },
      spec: {
        agentName: "screener-agent",
        category: "hr-screening",
        contextKeys: ["workspacePath", "userName"],
        entryPrompt: "You are a screener. Workspace: {{workspacePath}}, User: {{userName}}",
      },
    })
    const result = buildSystemPrompt("screener", {
      workspacePath: "/tmp/ws",
      userName: "Alice",
    })
    expect(result).toBe("You are a screener. Workspace: /tmp/ws, User: Alice")
  })

  it("injects extra context keys", () => {
    capabilityRegistry.install({
      apiVersion: "hsas.seven-hrops/v1",
      kind: "Capability",
      metadata: { name: "custom-cap", displayName: "custom-cap", description: "custom-cap card", source: "builtin", version: "1.0.0", createdAt: "2026-05-27T10:00:00Z" },
      spec: {
        agentName: "custom-agent",
        category: "hr-screening",
        contextKeys: [],
        entryPrompt: "Role: {{role}}",
      },
    })
    const result = buildSystemPrompt("custom-cap", { extra: { role: "screener" } })
    expect(result).toBe("Role: screener")
  })

  it("uses default values for missing options", () => {
    capabilityRegistry.install({
      apiVersion: "hsas.seven-hrops/v1",
      kind: "Capability",
      metadata: { name: "default-cap", displayName: "default-cap", description: "default-cap card", source: "builtin", version: "1.0.0", createdAt: "2026-05-27T10:00:00Z" },
      spec: {
        agentName: "default-agent",
        category: "hr-screening",
        contextKeys: [],
        entryPrompt: "Path: {{workspacePath}}",
      },
    })
    const result = buildSystemPrompt("default-cap")
    expect(result).toContain("~/SevenHROps/workspaces")
  })
})
