/**
 * Context Builder Types
 *
 * Shared types for template rendering and system prompt construction.
 * Source of truth: src/types/context.ts
 */

// ─── renderTemplate ──────────────────────────────────────────────────

export interface ContextInput {
  /** Template string containing {{key}} placeholders. */
  template: string
  /** Variable map: key → replacement value. */
  contextKeys: Record<string, string>
}

// ─── buildSystemPrompt ───────────────────────────────────────────────

export interface SystemPromptOptions {
  workspacePath?: string
  userName?: string
  currentDate?: string
  /** Additional key-value pairs merged into contextKeys. */
  extra?: Record<string, string>
}
