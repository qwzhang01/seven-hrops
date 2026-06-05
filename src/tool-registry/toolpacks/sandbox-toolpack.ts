/**
 * sandbox-toolpack — Phase B architecture fix (B-arch-fix).
 *
 * Encapsulates the sandbox session lifecycle (sandbox_create / sandbox_drop)
 * inside the toolRegistry L2→L1 channel, so that upper layers (workspaceManager,
 * services) never need to call Tauri invoke() directly.
 *
 * Design:
 *   - Both tools are BUILTIN_ONLY (no user/marketplace agent should manage
 *     sandbox sessions directly).
 *   - sandbox_create accepts { session_id, source } and delegates to the
 *     Rust `sandbox_create` command via _dispatcher.
 *   - sandbox_drop accepts { session_id } and delegates to `sandbox_drop`.
 *
 * Spec ref: openspec/changes/phase-b-platform-foundation (ADR-005 surface)
 */

import { z } from "zod"
import type { ToolRegistry } from "@/platform/registry/toolRegistry"
import { InvalidToolArgsError } from "@/types/toolpack"
import { metaOf } from "./_registry"
import { getDispatcher } from "./_dispatcher"

// ── Schemas ───────────────────────────────────────────────────────────────────

const SandboxCreateArgs = z.object({
  session_id: z.string().min(1),
  source: z.enum(["builtin", "user", "marketplace"]).default("builtin"),
  read_paths: z.array(z.string()).optional(),
  write_paths: z.array(z.string()).optional(),
  network_hosts: z.array(z.string()).optional(),
})

const SandboxDropArgs = z.object({
  session_id: z.string().min(1),
})

// ── Register ──────────────────────────────────────────────────────────────────

export function register(toolRegistry: ToolRegistry): void {
  // ── sandbox_create ────────────────────────────────────────────────────────
  toolRegistry.register(metaOf("sandbox_create"), async (args) => {
    const r = SandboxCreateArgs.safeParse(args)
    if (!r.success) {
      throw new InvalidToolArgsError(
        "sandbox_create",
        r.error.issues.map((i) => ({ path: i.path, message: i.message })),
      )
    }
    // Tauri command expects { args: SandboxCreateArgs }
    return getDispatcher()("sandbox_create", { args: r.data })
  })

  // ── sandbox_drop ──────────────────────────────────────────────────────────
  toolRegistry.register(metaOf("sandbox_drop"), async (args) => {
    const r = SandboxDropArgs.safeParse(args)
    if (!r.success) {
      throw new InvalidToolArgsError(
        "sandbox_drop",
        r.error.issues.map((i) => ({ path: i.path, message: i.message })),
      )
    }
    return getDispatcher()("sandbox_drop", { args: r.data })
  })
}
