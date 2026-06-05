/**
 * builder-toolpack — every tool here is a Phase H stub (Builder UX).
 * During development, calls are logged as warnings instead of throwing errors.
 *
 * Spec: openspec/changes/phase-b-platform-foundation/specs/mcp-toolpacks/spec.md
 */

import type { ToolRegistry } from "@/platform/registry/toolRegistry"
import { metaOf } from "./_registry"

export function register(toolRegistry: ToolRegistry): void {
  for (const name of [
    "create_agent_manifest",
    "create_skill_manifest",
    "create_capability_manifest",
    "list_available_tools",
  ] as const) {
    toolRegistry.register(metaOf(name), async (args) => {
      console.warn(`[builder-toolpack] "${name}" is not yet implemented (Phase H). args:`, args)
      return { stub: true, tool: name, message: "Phase H (Builder UX) — not yet implemented" }
    })
  }
}
