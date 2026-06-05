/**
 * Orchestrator Bridge — inbound webhook → orchestrator session; outbound push.
 *
 * Phase G Task 6.1~6.5: Real implementation.
 *
 * Design (D5): Each inbound message creates a fresh one-shot orchestrator session.
 * Sessions are ended within 30s (timeout protection). Multiple messages from the
 * same wecomUserId produce independent sessions — no state sharing.
 *
 * Architecture compliance:
 * - This service layer does NOT implement retry/timeout logic for LLM calls —
 *   that belongs to Runtime layer (Session.run). The 30s timeout here is a
 *   session-level safety net, not a per-LLM-call timeout.
 * - // TODO(arch-runtime-reliability-guards): move session timeout into
 *   Session.run so the Service layer no longer owns reliability.
 */

import type { WebhookPayload, OrchestratorSessionInfo } from "@/types/orchestrator"
import {
  startSession,
  endSession,
  getManagedSession,
} from "@/services/agentService"

export type { WebhookPayload }

// ─── Constants ───────────────────────────────────────────────────────

const SESSION_TIMEOUT_MS = 30_000
const DEFAULT_BOT_ID = () =>
  (typeof process !== "undefined" && process.env?.WECOM_BOT_ID) || "default-bot"

// ─── Active session tracking ─────────────────────────────────────────

/** Active orchestrator sessions keyed by sessionId. */
const activeSessions = new Map<string, OrchestratorSessionInfo>()

// ─── handleInbound ───────────────────────────────────────────────────

/**
 * Task 6.1: Handle an inbound webhook payload.
 *
 * Creates a fresh orchestrator session per inbound message, injects the
 * payload content as the first user message, and enforces a 30s timeout.
 */
export async function handleInbound(payload: WebhookPayload): Promise<void> {
  // Start a fresh one-shot orchestrator session (D5: one session per message)
  const { sessionId } = await startSession("orchestrator", {
    metadata: {
      wecomUserId: payload.fromUserId,
      parentSessionId: null,
      delegateDepth: 0,
      transferredFrom: null,
    },
  })

  // Task 6.2: 30s session timeout — force endSession if not completed
  const timeoutHandle = setTimeout(async () => {
    const session = getManagedSession(sessionId)
    if (session && session.state !== "ended") {
      await endSession(sessionId, "timeout").catch(() => undefined)
      activeSessions.delete(sessionId)
      // Audit log is handled inside endSession via metricsService
      console.warn(
        `[orchestratorBridge] session ${sessionId} timed out after ${SESSION_TIMEOUT_MS}ms (wecomUserId=${payload.fromUserId})`,
      )
    }
  }, SESSION_TIMEOUT_MS)

  activeSessions.set(sessionId, {
    sessionId,
    wecomUserId: payload.fromUserId,
    startedAt: Date.now(),
    timeoutHandle,
  })

  try {
    // Inject the inbound content as the first user message via agentService
    // The orchestrator agent will process it and may call get_all_tasks /
    // send_wecom_message tools as needed.
    const { chatWithStream } = await import("@/services/agentService")
    await chatWithStream(
      {
        sessionID: sessionId,
        message: payload.content,
        // orchestrator capability is resolved via capabilityId
        capabilityId: "orchestrator",
      },
      (_event) => {
        // Events are handled by the session runtime; bridge only needs
        // to know when the session completes (via finish event).
      },
    )
  } finally {
    clearTimeout(timeoutHandle)
    activeSessions.delete(sessionId)
    const session = getManagedSession(sessionId)
    if (session && session.state !== "ended") {
      await endSession(sessionId).catch(() => undefined)
    }
  }
}

// ─── pushOutbound ────────────────────────────────────────────────────

/**
 * Task 6.3: Send an outbound message to a user via send_wecom_message tool.
 *
 * Calls agentService.invokeTool (via chatWithStream with a direct tool invocation
 * pattern) targeting the send_wecom_message tool.
 */
export async function pushOutbound(toUser: string, content: string): Promise<void> {
  const botId = DEFAULT_BOT_ID()

  // Start a minimal orchestrator session for the outbound push
  const { sessionId } = await startSession("orchestrator", {
    metadata: {
      wecomUserId: toUser,
      parentSessionId: null,
      delegateDepth: 0,
      transferredFrom: null,
    },
  })

  try {
    // Invoke send_wecom_message tool directly via the orchestrator session
    const { chatWithStream } = await import("@/services/agentService")
    await chatWithStream(
      {
        sessionID: sessionId,
        message: `[SYSTEM: Direct outbound push] Call send_wecom_message with botId="${botId}", toUser="${toUser}", content="${content}"`,
        capabilityId: "orchestrator",
      },
      (_event) => {
        // No-op: we only care about completion
      },
    )
  } finally {
    await endSession(sessionId).catch(() => undefined)
  }
}

// ─── Test helpers ────────────────────────────────────────────────────

/** @internal — tests only. */
export function getActiveSessionsForTest(): Map<string, OrchestratorSessionInfo> {
  return activeSessions
}

/** @internal — tests only. */
export function clearActiveSessionsForTest(): void {
  for (const info of activeSessions.values()) {
    clearTimeout(info.timeoutHandle)
  }
  activeSessions.clear()
}

// ─── Task 6.4: Tauri event listener setup ────────────────────────────

/**
 * Task 6.4: Register the Tauri `wecom-inbound` event listener.
 *
 * Called once during application bootstrap (after bootstrapPlatform succeeds).
 * In non-Tauri environments (browser dev / tests), this is a no-op.
 */
export async function setupWecomListener(): Promise<void> {
  // Only register in Tauri desktop environment
  if (typeof window === "undefined" || !("__TAURI__" in window)) {
    return
  }
  try {
    const { listen } = await import("@tauri-apps/api/event")
    await listen<WebhookPayload>("wecom-inbound", (event) => {
      handleInbound(event.payload).catch((err) => {
        console.error("[orchestratorBridge] handleInbound error:", err)
      })
    })
  } catch (err) {
    // Non-fatal: if Tauri event API is unavailable, log and continue
    console.warn("[orchestratorBridge] failed to register wecom-inbound listener:", err)
  }
}
