/**
 * toolWhitelistGuard — per-call manifest-level whitelist enforcement.
 *
 * Layered defense:
 *   L0 Rust  — `sandbox::fs_guard / network_guard` (path/host whitelist)
 *   L2 JS    — `toolRegistry.assertAllowed(name, source)` (source category)
 *   L2 JS    — **this module** (manifest `spec.tools.allowed` per-call gate)
 *
 * The toolRegistry.assertAllowed() check answers "is this tool allowed for
 * any user-source agent in general?". This guard answers "is this specific
 * tool allowed for *this specific agent's* current task?", driven by the
 * manifest's own `spec.tools.allowed` array.
 *
 * Usage:
 *   const guard = createToolWhitelistGuard(agentManifest.spec.tools.allowed)
 *   guard.assert("read_file") // ok
 *   guard.assert("rm -rf /")  // throws ToolNotInManifestError
 */

export class ToolNotInManifestError extends Error {
  readonly code = "TOOL_NOT_IN_MANIFEST" as const
  constructor(toolName: string, allowed: ReadonlyArray<string>) {
    super(
      `Tool "${toolName}" is not declared in the agent manifest's spec.tools.allowed (allowed: ${allowed.join(", ") || "<empty>"})`,
    )
    this.name = "ToolNotInManifestError"
  }
}

export interface ToolWhitelistGuard {
  readonly allowed: ReadonlySet<string>
  has(name: string): boolean
  assert(name: string): void
}

export const createToolWhitelistGuard = (
  allowed: ReadonlyArray<string>,
): ToolWhitelistGuard => {
  const set = new Set(allowed)
  return {
    allowed: set,
    has: (name: string) => set.has(name),
    assert(name: string) {
      if (!set.has(name)) {
        throw new ToolNotInManifestError(name, allowed)
      }
    },
  }
}
