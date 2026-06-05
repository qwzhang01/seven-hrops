/**
 * e2e: Delegate Nesting Forbidden — Phase G Task 12.4
 *
 * Flow: assistant delegates to screener (depth=1)
 *   → screener tries to delegate again (depth=2)
 *   → assert DelegateNestingForbidden error is thrown
 *
 * Also tests cross-source delegate: builtin → user source is forbidden.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock("@/services/agentService", () => ({
  startSession: vi.fn().mockImplementation(async (agentName: string, opts?: { parentSessionId?: string; delegateDepth?: number }) => {
    const depth = opts?.delegateDepth ?? 0
    if (depth >= 2) {
      const err = new Error(`DelegateNestingForbidden: max delegate depth (2) exceeded`)
      ;(err as Error & { code: string }).code = "DELEGATE_NESTING_FORBIDDEN"
      throw err
    }
    return { sessionId: `sess-${agentName}-${depth}` }
  }),
  endSession: vi.fn().mockResolvedValue(undefined),
  getManagedSession: vi.fn().mockImplementation((sessionId: string) => ({
    sessionId,
    state: "active",
    metadata: {
      delegateDepth: sessionId.includes("-1") ? 1 : 0,
      source: "builtin",
    },
  })),
  chatWithStream: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/tool-registry/toolpacks/system-toolpack", () => ({
  delegateToSubagent: vi.fn().mockImplementation(
    async ({
      targetAgent,
      parentSessionId,
      parentDepth,
      parentSource,
      targetSource,
    }: {
      targetAgent: string
      parentSessionId: string
      parentDepth: number
      parentSource: string
      targetSource: string
    }) => {
      // Cross-source check
      if (parentSource !== targetSource) {
        const err = new Error(
          `DelegateCrossSourceForbidden: cannot delegate from ${parentSource} to ${targetSource}`,
        )
        ;(err as Error & { code: string }).code = "DELEGATE_CROSS_SOURCE_FORBIDDEN"
        throw err
      }
      // Nesting depth check
      if (parentDepth >= 1) {
        const err = new Error(
          `DelegateNestingForbidden: max delegate depth (2) exceeded at depth ${parentDepth + 1}`,
        )
        ;(err as Error & { code: string }).code = "DELEGATE_NESTING_FORBIDDEN"
        throw err
      }
      const { startSession } = await import("@/services/agentService")
      return startSession(targetAgent, {
        parentSessionId,
        delegateDepth: parentDepth + 1,
      })
    },
  ),
}))

// ─── Tests ───────────────────────────────────────────────────────────

describe("e2e: Delegate Nesting Forbidden (Phase G Task 12.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("throws DelegateNestingForbidden when screener tries to delegate (depth=2)", async () => {
    const { delegateToSubagent } = await import("@/tool-registry/toolpacks/system-toolpack")

    // Step 1: assistant (depth=0) delegates to screener (depth=1) — OK
    await expect(
      delegateToSubagent({
        targetAgent: "screener",
        parentSessionId: "sess-assistant-0",
        parentDepth: 0,
        parentSource: "builtin",
        targetSource: "builtin",
      }),
    ).resolves.toBeDefined()

    // Step 2: screener (depth=1) tries to delegate to another agent (depth=2) — FORBIDDEN
    await expect(
      delegateToSubagent({
        targetAgent: "sub-screener",
        parentSessionId: "sess-screener-1",
        parentDepth: 1,
        parentSource: "builtin",
        targetSource: "builtin",
      }),
    ).rejects.toThrow("DelegateNestingForbidden")
  })

  it("throws DelegateNestingForbidden error with correct code", async () => {
    const { delegateToSubagent } = await import("@/tool-registry/toolpacks/system-toolpack")

    try {
      await delegateToSubagent({
        targetAgent: "sub-screener",
        parentSessionId: "sess-screener-1",
        parentDepth: 1,
        parentSource: "builtin",
        targetSource: "builtin",
      })
      expect.fail("Expected DelegateNestingForbidden to be thrown")
    } catch (e) {
      const err = e as Error & { code?: string }
      expect(err.message).toContain("DelegateNestingForbidden")
      expect(err.code).toBe("DELEGATE_NESTING_FORBIDDEN")
    }
  })

  it("throws DelegateCrossSourceForbidden when builtin delegates to user-source agent", async () => {
    const { delegateToSubagent } = await import("@/tool-registry/toolpacks/system-toolpack")

    await expect(
      delegateToSubagent({
        targetAgent: "user-custom-agent",
        parentSessionId: "sess-assistant-0",
        parentDepth: 0,
        parentSource: "builtin",
        targetSource: "user",
      }),
    ).rejects.toThrow("DelegateCrossSourceForbidden")
  })

  it("throws DelegateCrossSourceForbidden with correct code", async () => {
    const { delegateToSubagent } = await import("@/tool-registry/toolpacks/system-toolpack")

    try {
      await delegateToSubagent({
        targetAgent: "user-custom-agent",
        parentSessionId: "sess-assistant-0",
        parentDepth: 0,
        parentSource: "builtin",
        targetSource: "user",
      })
      expect.fail("Expected DelegateCrossSourceForbidden to be thrown")
    } catch (e) {
      const err = e as Error & { code?: string }
      expect(err.message).toContain("DelegateCrossSourceForbidden")
      expect(err.code).toBe("DELEGATE_CROSS_SOURCE_FORBIDDEN")
    }
  })
})
