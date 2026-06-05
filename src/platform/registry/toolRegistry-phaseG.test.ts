/**
 * toolRegistry-phaseG.test.ts — Phase G Tasks 4.3 / 4.4 / 4.5 / 4.6
 *
 * Tests:
 *   4.3 ControlToolMustBeBuiltinOnly: control tool with non-builtin source → rejected
 *   4.4 MessagingToolMustGatePermission: messaging tool with user source + no requireApproval → rejected
 *   4.5 ownerAgent guard: invoke with wrong agentName → TOOL_OWNER_AGENT_MISMATCH
 *   4.6 listByOwnerAgent: returns only tools owned by the specified agent
 */

import { describe, it, expect, beforeEach } from "vitest"
import { toolRegistry } from "@/platform/registry/toolRegistry"
import type { ToolMeta } from "@/platform/registry/toolRegistry"

beforeEach(() => {
  toolRegistry.clearForTest()
})

// ─── Task 4.3: ControlToolMustBeBuiltinOnly ──────────────────────────

describe("ControlToolMustBeBuiltinOnly (Task 4.3)", () => {
  it("rejects control-category tool that allows user source", () => {
    const meta: ToolMeta = {
      name: "bad_control_tool",
      category: "control",
      riskLevel: "high",
      description: "A control tool that incorrectly allows user source",
      defaultAllowedSources: ["builtin", "user"],
      requireApproval: false,
    }

    expect(() => toolRegistry.register(meta, () => undefined)).toThrow(
      "ControlToolMustBeBuiltinOnly",
    )
  })

  it("accepts control-category tool that is builtin-only", () => {
    const meta: ToolMeta = {
      name: "good_control_tool",
      category: "control",
      riskLevel: "high",
      description: "A control tool correctly restricted to builtin",
      defaultAllowedSources: ["builtin"],
      requireApproval: false,
    }

    expect(() => toolRegistry.register(meta, () => undefined)).not.toThrow()
  })
})

// ─── Task 4.4: MessagingToolMustGatePermission ───────────────────────

describe("MessagingToolMustGatePermission (Task 4.4)", () => {
  it("rejects messaging-category tool with user source but no requireApproval", () => {
    const meta: ToolMeta = {
      name: "bad_messaging_tool",
      category: "messaging",
      riskLevel: "medium",
      description: "A messaging tool that allows user source without approval",
      defaultAllowedSources: ["builtin", "user"],
      requireApproval: false,
    }

    expect(() => toolRegistry.register(meta, () => undefined)).toThrow(
      "MessagingToolMustGatePermission",
    )
  })

  it("accepts messaging-category tool with user source and requireApproval: true", () => {
    const meta: ToolMeta = {
      name: "good_messaging_tool",
      category: "messaging",
      riskLevel: "medium",
      description: "A messaging tool with proper approval gate",
      defaultAllowedSources: ["builtin", "user"],
      requireApproval: true,
    }

    expect(() => toolRegistry.register(meta, () => undefined)).not.toThrow()
  })

  it("accepts messaging-category tool that is builtin-only (no user source)", () => {
    const meta: ToolMeta = {
      name: "builtin_messaging_tool",
      category: "messaging",
      riskLevel: "medium",
      description: "A messaging tool restricted to builtin",
      defaultAllowedSources: ["builtin"],
      requireApproval: false,
    }

    expect(() => toolRegistry.register(meta, () => undefined)).not.toThrow()
  })
})

// ─── Task 4.5: ownerAgent guard ─────────────────────────────────────

describe("ownerAgent guard (Task 4.5)", () => {
  const meta: ToolMeta = {
    name: "owned_tool",
    category: "safe",
    riskLevel: "low",
    description: "A tool owned by agent-a",
    defaultAllowedSources: ["builtin"],
    requireApproval: false,
    ownerAgent: "agent-a",
  }

  beforeEach(() => {
    toolRegistry.register(meta, async () => ({ ok: true }))
  })

  it("allows invocation when agentName matches ownerAgent", async () => {
    const result = await toolRegistry.invoke(
      "owned_tool",
      {},
      { sessionId: "s1", source: "builtin", agentName: "agent-a" },
    )
    expect(result).toMatchObject({ ok: true })
  })

  it("rejects invocation when agentName does not match ownerAgent", async () => {
    await expect(
      toolRegistry.invoke(
        "owned_tool",
        {},
        { sessionId: "s1", source: "builtin", agentName: "agent-b" },
      ),
    ).rejects.toThrow("TOOL_OWNER_AGENT_MISMATCH")
  })

  it("allows invocation when agentName is not provided (backward compat)", async () => {
    // When agentName is undefined, the guard is skipped for backward compatibility
    const result = await toolRegistry.invoke(
      "owned_tool",
      {},
      { sessionId: "s1", source: "builtin" },
    )
    expect(result).toMatchObject({ ok: true })
  })
})

// ─── Task 4.6: listByOwnerAgent ─────────────────────────────────────

describe("listByOwnerAgent (Task 4.6)", () => {
  beforeEach(() => {
    toolRegistry.register(
      {
        name: "tool_a1",
        category: "safe",
        riskLevel: "low",
        description: "Owned by agent-a",
        defaultAllowedSources: ["builtin"],
        requireApproval: false,
        ownerAgent: "agent-a",
      },
      () => undefined,
    )
    toolRegistry.register(
      {
        name: "tool_a2",
        category: "safe",
        riskLevel: "low",
        description: "Also owned by agent-a",
        defaultAllowedSources: ["builtin"],
        requireApproval: false,
        ownerAgent: "agent-a",
      },
      () => undefined,
    )
    toolRegistry.register(
      {
        name: "tool_b1",
        category: "safe",
        riskLevel: "low",
        description: "Owned by agent-b",
        defaultAllowedSources: ["builtin"],
        requireApproval: false,
        ownerAgent: "agent-b",
      },
      () => undefined,
    )
    toolRegistry.register(
      {
        name: "tool_shared",
        category: "safe",
        riskLevel: "low",
        description: "No owner",
        defaultAllowedSources: ["builtin"],
        requireApproval: false,
      },
      () => undefined,
    )
  })

  it("returns only tools owned by the specified agent", () => {
    const result = toolRegistry.listByOwnerAgent("agent-a")
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.name).sort()).toEqual(["tool_a1", "tool_a2"])
  })

  it("returns empty array for agent with no owned tools", () => {
    const result = toolRegistry.listByOwnerAgent("agent-c")
    expect(result).toHaveLength(0)
  })
})
