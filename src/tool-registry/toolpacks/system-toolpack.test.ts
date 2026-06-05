/**
 * system-toolpack.test.ts — Phase G Task 2.5
 *
 * Tests:
 *   activate_capability: success / not-found / hidden-rejected
 *   delegate_to_subagent: success / nesting-forbidden / cross-source-forbidden
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { toolRegistry } from "@/platform/registry/toolRegistry"
import { register } from "./system-toolpack"
import { metaOf } from "./_registry"

// ─── Mocks ───────────────────────────────────────────────────────────

// Mock agentService
const mockStartSession = vi.fn().mockResolvedValue({ sessionId: "new-session-1" })
const mockPauseSession = vi.fn().mockResolvedValue(undefined)
const mockTransferContext = vi.fn().mockResolvedValue(undefined)
const mockGetManagedSession = vi.fn()

vi.mock("@/services/agentService", () => ({
  startSession: (...args: any[]) => mockStartSession(...args),
  pauseSession: (...args: any[]) => mockPauseSession(...args),
  transferContext: (...args: any[]) => mockTransferContext(...args),
  getManagedSession: (...args: any[]) => mockGetManagedSession(...args),
}))

// Mock capabilityRegistry
const mockCapabilityGet = vi.fn()
const mockCapabilityList = vi.fn().mockReturnValue([])

vi.mock("@/platform/registry/capabilityRegistry", () => ({
  capabilityRegistry: {
    get: (...args: any[]) => mockCapabilityGet(...args),
    list: (...args: any[]) => mockCapabilityList(...args),
  },
}))

// Mock capabilityStore
const mockActivateCapability = vi.fn()
vi.mock("@/stores/capabilityStore", () => ({
  useCapabilityStore: {
    getState: () => ({
      activeCapabilityId: "prev-capability",
      activateCapability: mockActivateCapability,
    }),
  },
}))

// Mock silentSwitchStore
const mockSetPending = vi.fn()
vi.mock("@/stores/silentSwitchStore", () => ({
  useSilentSwitchStore: {
    getState: () => ({
      setPending: mockSetPending,
    }),
  },
}))

// Mock dispatcher for models_ensure
vi.mock("./_dispatcher", () => ({
  getDispatcher: () => vi.fn().mockResolvedValue({ ok: true }),
}))

// ─── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  toolRegistry.clearForTest()
  register(toolRegistry)
  vi.clearAllMocks()
})

const CTX = { sessionId: "test-session-001", source: "builtin" as const }

// ─── activate_capability ─────────────────────────────────────────────

describe("activate_capability", () => {
  it("success: activates an existing enabled non-hidden capability", async () => {
    mockCapabilityGet.mockReturnValue({
      id: "resume-screening",
      enabled: true,
      source: "builtin",
      manifest: {
        spec: { agentName: "screener", hidden: false },
      },
    })
    mockGetManagedSession.mockReturnValue({ state: "active", agentName: "assistant" })

    const result = await toolRegistry.invoke(
      "activate_capability",
      { capabilityId: "resume-screening" },
      CTX,
    )

    expect(result).toMatchObject({
      success: true,
      activatedCapability: "resume-screening",
      agentName: "screener",
      sessionId: "new-session-1",
    })
    expect(mockPauseSession).toHaveBeenCalledWith("test-session-001")
    expect(mockStartSession).toHaveBeenCalledWith("screener", expect.objectContaining({
      transferredFrom: expect.objectContaining({ capability: "prev-capability" }),
    }))
    expect(mockActivateCapability).toHaveBeenCalledWith("resume-screening")
  })

  it("rejects when capability does not exist", async () => {
    mockCapabilityGet.mockReturnValue(undefined)

    await expect(
      toolRegistry.invoke("activate_capability", { capabilityId: "nonexistent" }, CTX),
    ).rejects.toThrow("CAPABILITY_NOT_FOUND")
  })

  it("rejects when capability is hidden", async () => {
    mockCapabilityGet.mockReturnValue({
      id: "orchestrator",
      enabled: true,
      source: "builtin",
      manifest: {
        spec: { agentName: "orchestrator", hidden: true },
      },
    })

    await expect(
      toolRegistry.invoke("activate_capability", { capabilityId: "orchestrator" }, CTX),
    ).rejects.toThrow("CAPABILITY_HIDDEN")
  })
})

// ─── delegate_to_subagent ────────────────────────────────────────────

describe("delegate_to_subagent", () => {
  it("success: delegates to a same-source agent within depth limit", async () => {
    mockGetManagedSession.mockReturnValue({
      agentName: "assistant",
      metadata: { delegateDepth: 0 },
    })
    mockCapabilityList.mockReturnValue([
      {
        source: "builtin",
        manifest: { spec: { agentName: "assistant" } },
      },
      {
        source: "builtin",
        manifest: { spec: { agentName: "screener" } },
      },
    ])

    const result = await toolRegistry.invoke(
      "delegate_to_subagent",
      { agentName: "screener", prompt: "Screen this resume" },
      CTX,
    )

    expect(result).toMatchObject({
      success: true,
      delegatedTo: "screener",
      childSessionId: "new-session-1",
      prompt: "Screen this resume",
    })
    expect(mockStartSession).toHaveBeenCalledWith("screener", expect.objectContaining({
      parentSessionId: "test-session-001",
      delegateDepth: 1,
    }))
  })

  it("rejects when delegate depth >= 2 (DelegateNestingForbidden)", async () => {
    mockGetManagedSession.mockReturnValue({
      agentName: "screener",
      metadata: { delegateDepth: 2 },
    })

    await expect(
      toolRegistry.invoke(
        "delegate_to_subagent",
        { agentName: "report-writer", prompt: "Write report" },
        CTX,
      ),
    ).rejects.toThrow("DelegateNestingForbidden")
  })

  it("rejects cross-source delegation (DelegateCrossSourceForbidden)", async () => {
    mockGetManagedSession.mockReturnValue({
      agentName: "assistant",
      metadata: { delegateDepth: 0 },
    })
    // Parent is builtin, target is user
    mockCapabilityList.mockReturnValue([
      {
        source: "builtin",
        manifest: { spec: { agentName: "assistant" } },
      },
      {
        source: "user",
        manifest: { spec: { agentName: "custom-agent" } },
      },
    ])

    await expect(
      toolRegistry.invoke(
        "delegate_to_subagent",
        { agentName: "custom-agent", prompt: "Do something" },
        CTX,
      ),
    ).rejects.toThrow("DelegateCrossSourceForbidden")
  })
})
