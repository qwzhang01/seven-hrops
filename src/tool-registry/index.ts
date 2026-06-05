/**
 * MCP Toolpack Registrar — Phase B replacement for the old `node` MCP stdio
 * server. There is no longer any in-process MCP middleware: tools live as
 * platform-recognised entries in `toolRegistry`, and the L2 (`AgentLoader` /
 * SkillLoader) calls them via `toolRegistry.invoke(...)`.
 *
 * Public API:
 *   - `registerAllToolpacks(toolRegistry)` — wires fs / parse / webserver /
 *     export / system / builder toolpacks. Idempotent across calls (each
 *     toolpack throws DUPLICATE_TOOL_NAME if invoked twice — caller is
 *     expected to construct a fresh registry per process startup, except in
 *     tests which use `toolRegistry.clearForTest()` between cases).
 *
 * Spec: openspec/changes/phase-b-platform-foundation/specs/mcp-toolpacks/spec.md
 */

import type { ToolRegistry } from "@/platform/registry/toolRegistry"

import { register as registerFs } from "./toolpacks/fs-toolpack"
import { register as registerParse } from "./toolpacks/parse-toolpack"
import { register as registerWebserver } from "./toolpacks/webserver-toolpack"
import { register as registerExport } from "./toolpacks/export-toolpack"
import { register as registerSystem } from "./toolpacks/system-toolpack"
import { register as registerBuilder } from "./toolpacks/builder-toolpack"
import { register as registerSandbox } from "./toolpacks/sandbox-toolpack"
import { register as registerNetwork } from "./toolpacks/network-toolpack"
import { register as registerMusic } from "./toolpacks/music-toolpack"
import { register as registerOrchestrator } from "./toolpacks/orchestrator-toolpack"
import { register as registerAssistant } from "./toolpacks/assistant-toolpack"

export interface RegisterAllOptions {
  /**
   * When `true`, builder-toolpack is skipped. Production builds keep builder
   * tools out of the user-facing registry entirely (they're builtin-only and
   * still NOT_IMPLEMENTED in Phase B).
   */
  readonly skipBuilder?: boolean
}

export function registerAllToolpacks(
  toolRegistry: ToolRegistry,
  opts: RegisterAllOptions = {},
): void {
  registerSandbox(toolRegistry)  // Must be first: other toolpacks depend on sandbox sessions
  registerFs(toolRegistry)
  registerParse(toolRegistry)
  registerWebserver(toolRegistry)
  registerExport(toolRegistry)
  registerNetwork(toolRegistry)
  registerMusic(toolRegistry)
  registerSystem(toolRegistry)
  registerOrchestrator(toolRegistry)
  registerAssistant(toolRegistry)
  if (!opts.skipBuilder) {
    registerBuilder(toolRegistry)
  }
}

// Re-export toolpack registers so callers can opt into a custom subset.
export {
  registerSandbox,
  registerFs,
  registerParse,
  registerWebserver,
  registerExport,
  registerNetwork,
  registerMusic,
  registerSystem,
  registerOrchestrator,
  registerAssistant,
  registerBuilder,
}
