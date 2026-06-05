/**
 * Metrics Types
 *
 * Shared types for the metrics service (audit log events).
 * Source of truth: src/types/metrics.ts
 */

export type MetricEventType = "tool-call" | "token-usage" | "error"

export interface MetricEvent {
  type: MetricEventType
  sessionId: string
  capabilityId?: string
  toolName?: string
  tokenCount?: number
  errorCode?: string
  timestamp: number
}
