/**
 * Context Builder — template rendering and system prompt construction.
 *
 * Design notes:
 *   - renderTemplate is a pure function with no side effects.
 *   - buildSystemPrompt reads from capabilityRegistry (synchronous singleton)
 *     and falls back to a default prompt when the capability is not found.
 */

import { capabilityRegistry } from "@/platform/registry/capabilityRegistry"
import type { ContextInput, SystemPromptOptions } from "@/types/context"

export type { ContextInput, SystemPromptOptions }

// ─── renderTemplate ──────────────────────────────────────────────────

/**
 * Replace {{key}} placeholders in `template` with values from `contextKeys`.
 * Unknown keys are preserved as-is (e.g. {{unknown}} stays {{unknown}}).
 * Pure function — no side effects, no async.
 */
export function renderTemplate({ template, contextKeys }: ContextInput): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => contextKeys[key] ?? `{{${key}}}`)
}

// ─── buildSystemPrompt ───────────────────────────────────────────────

const DEFAULT_PROMPT = "You are Seven, an AI assistant for HR operations."

/**
 * Derive the available capabilities list for the assistant's system prompt.
 * Filters out hidden capabilities and formats them as a readable list.
 */
function deriveAvailableCapabilities(): string {
  const records = capabilityRegistry.list({ enabled: true })
  const visible = records.filter((r) => !r.manifest.spec.hidden)
  if (visible.length === 0) return "(暂无可用能力)"

  return visible
    .map((r) => {
      const m = r.manifest
      return `- **${m.metadata.displayName}** (id: \`${r.id}\`): ${m.metadata.description}`
    })
    .join("\n")
}

/**
 * Build a system prompt for the given capability.
 *
 * Uses `capabilityRegistry.get(capabilityId)` to look up the manifest's
 * `spec.entryPrompt` as the template. Falls back to DEFAULT_PROMPT when:
 *   - capabilityId is undefined / empty
 *   - capability is not registered
 *   - spec.entryPrompt is absent
 */
export function buildSystemPrompt(
  capabilityId: string | undefined,
  options: SystemPromptOptions = {},
): string {
  if (!capabilityId) return DEFAULT_PROMPT

  const record = capabilityRegistry.get(capabilityId)
  const template = record?.manifest.spec.entryPrompt
  if (!template) return DEFAULT_PROMPT

  const contextKeys: Record<string, string> = {
    workspacePath: options.workspacePath ?? "~/SevenHROps/workspaces",
    userName: options.userName ?? "User",
    currentDate: options.currentDate ?? new Date().toISOString().split("T")[0],
    availableCapabilities: deriveAvailableCapabilities(),
    ...options.extra,
  }

  return renderTemplate({ template, contextKeys })
}
