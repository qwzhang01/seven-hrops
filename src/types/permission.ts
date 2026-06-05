/**
 * Permission Types
 *
 * Shared types for the sandbox permission request queue.
 * Source of truth: src/types/permission.ts
 */

export type RiskLevel = "low" | "medium" | "high"
export type PermissionStatus = "pending" | "approved" | "denied"

export interface PermissionRequest {
  id: string
  sessionId: string
  toolName: string
  riskLevel: RiskLevel
  /** Human-readable description of what the tool will do. */
  description: string
  requestedAt: number
  status: PermissionStatus
}
