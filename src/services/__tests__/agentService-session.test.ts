/**
 * Tests for Agent Service — Phase G session lifecycle extensions.
 *
 * Covers: startSession, transferContext, pauseSession, resumeSession, endSession.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  startSession,
  transferContext,
  pauseSession,
  resumeSession,
  endSession,
  getManagedSession,
  appendTranscript,
  clearManagedSessionsForTest,
} from "@/services/agentService"

// ─── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  clearManagedSessionsForTest()
  // Ensure no platform runtime (mock fallback path)
  delete (window as any).__platform
})

// ─── startSession ────────────────────────────────────────────────────

describe("startSession", () => {
  it("creates a session with default metadata", async () => {
    const result = await startSession("assistant")
    expect(result.sessionId).toBeTruthy()
    expect(result.agentName).toBe("assistant")

    const session = getManagedSession(result.sessionId)
    expect(session).toBeDefined()
    expect(session!.state).toBe("active")
    expect(session!.metadata.parentSessionId).toBeNull()
    expect(session!.metadata.delegateDepth).toBe(0)
    expect(session!.metadata.transferredFrom).toBeNull()
  })

  it("creates a session with parent metadata", async () => {
    const result = await startSession("screener", {
      parentSessionId: "parent-123",
      delegateDepth: 1,
    })

    const session = getManagedSession(result.sessionId)
    expect(session!.metadata.parentSessionId).toBe("parent-123")
    expect(session!.metadata.delegateDepth).toBe(1)
  })

  it("throws on empty agentName", async () => {
    await expect(startSession("")).rejects.toThrow("START_SESSION_AGENT_REQUIRED")
    await expect(startSession("  ")).rejects.toThrow("START_SESSION_AGENT_REQUIRED")
  })
})

// ─── transferContext ─────────────────────────────────────────────────

describe("transferContext", () => {
  it("transfers last N messages as summary", async () => {
    const from = await startSession("assistant")
    const to = await startSession("screener")

    // Simulate transcripts
    appendTranscript(from.sessionId, "user", "帮我筛简历")
    appendTranscript(from.sessionId, "assistant", "好的，请提供 JD")
    appendTranscript(from.sessionId, "user", "JD 是产品经理")

    await transferContext(from.sessionId, to.sessionId, { lastNMessages: 2 })

    const toSession = getManagedSession(to.sessionId)
    expect(toSession!.metadata.transferredFrom).toBeDefined()
    expect(toSession!.metadata.transferredFrom!.capability).toBe("assistant")
    expect(toSession!.metadata.transferredFrom!.summary).toContain("好的，请提供 JD")
    expect(toSession!.metadata.transferredFrom!.summary).toContain("JD 是产品经理")
    // Should NOT contain the first message (only last 2)
    expect(toSession!.metadata.transferredFrom!.summary).not.toContain("帮我筛简历")
  })

  it("throws when source session not found", async () => {
    const to = await startSession("screener")
    await expect(
      transferContext("nonexistent", to.sessionId),
    ).rejects.toThrow("TRANSFER_SOURCE_NOT_FOUND")
  })

  it("throws when target session not found", async () => {
    const from = await startSession("assistant")
    await expect(
      transferContext(from.sessionId, "nonexistent"),
    ).rejects.toThrow("TRANSFER_TARGET_NOT_FOUND")
  })
})

// ─── pauseSession / resumeSession ────────────────────────────────────

describe("pauseSession / resumeSession state machine", () => {
  it("pauses an active session", async () => {
    const { sessionId } = await startSession("assistant")
    await pauseSession(sessionId)
    expect(getManagedSession(sessionId)!.state).toBe("paused")
  })

  it("resumes a paused session", async () => {
    const { sessionId } = await startSession("assistant")
    await pauseSession(sessionId)
    await resumeSession(sessionId)
    expect(getManagedSession(sessionId)!.state).toBe("active")
  })

  it("throws when resuming a non-paused session", async () => {
    const { sessionId } = await startSession("assistant")
    await expect(resumeSession(sessionId)).rejects.toThrow("RESUME_SESSION_NOT_PAUSED")
  })

  it("throws when pausing an ended session", async () => {
    const { sessionId } = await startSession("assistant")
    await endSession(sessionId)
    await expect(pauseSession(sessionId)).rejects.toThrow("PAUSE_SESSION_ALREADY_ENDED")
  })

  it("throws when resuming an ended session", async () => {
    const { sessionId } = await startSession("assistant")
    await endSession(sessionId)
    await expect(resumeSession(sessionId)).rejects.toThrow("RESUME_SESSION_ALREADY_ENDED")
  })

  it("throws on unknown session id", async () => {
    await expect(pauseSession("unknown")).rejects.toThrow("PAUSE_SESSION_NOT_FOUND")
    await expect(resumeSession("unknown")).rejects.toThrow("RESUME_SESSION_NOT_FOUND")
  })
})

// ─── endSession ──────────────────────────────────────────────────────

describe("endSession", () => {
  it("ends a session permanently", async () => {
    const { sessionId } = await startSession("assistant")
    await endSession(sessionId)
    expect(getManagedSession(sessionId)!.state).toBe("ended")
  })

  it("throws on unknown session", async () => {
    await expect(endSession("unknown")).rejects.toThrow("END_SESSION_NOT_FOUND")
  })
})
