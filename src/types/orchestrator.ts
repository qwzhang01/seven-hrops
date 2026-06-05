/**
 * Orchestrator Bridge Types
 *
 * Shared types for the enterprise webhook integration.
 * Source of truth: src/types/orchestrator.ts
 */

/** Inbound webhook payload from Rust wecom handler (camelCase, matches WecomInboundPayload). */
export interface WebhookPayload {
  fromUserId: string
  content: string
  msgType: string
  msgId?: string
  receivedAt: number
}

/** Active orchestrator session info for timeout tracking. */
export interface OrchestratorSessionInfo {
  sessionId: string
  wecomUserId: string
  startedAt: number
  timeoutHandle: ReturnType<typeof setTimeout>
}
