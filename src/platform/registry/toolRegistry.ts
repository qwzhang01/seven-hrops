export type ToolCategory = "safe" | "write" | "parse" | "sensitive" | "system" | "builder" | "network" | "control" | "messaging"

export type RiskLevel = "low" | "medium" | "high" | "critical"

export type ToolSource = "builtin" | "user" | "marketplace"

export interface ToolMeta {
  /** Unique tool name; matches the value referenced from Manifest `tools.allowed`. */
  readonly name: string
  /** Coarse category — used by UI filters and audit logs. */
  readonly category: ToolCategory
  /** Risk level — drives the default approval policy. */
  readonly riskLevel: RiskLevel
  /** Human-readable description. */
  readonly description: string
  /**
   * Sources that are allowed to use this tool by default.
   *
   *   - `"builtin"` → tools that ship inside the application.
   *   - `"user"` → tools any user-authored agent can use.
   *   - `"marketplace"` → tools agents installed from the marketplace can use.
   */
  readonly defaultAllowedSources: ReadonlyArray<ToolSource>
  /** Whether this tool requires explicit user approval at runtime. */
  readonly requireApproval: boolean
  /**
   * Phase F: Whether this tool requires a PermissionPrompt before first use
   * by user-source agents. Required for network-category tools that allow
   * user source — enforced by toolRegistry.register().
   */
  readonly requiresPermissionPrompt?: boolean
}

export interface ListOptions {
  readonly category?: ToolCategory
  readonly source?: ToolSource
  readonly riskLevel?: RiskLevel
}

/** Invocation context — every L1 call must carry sandbox session + manifest source. */
export interface InvokeContext {
  readonly sessionId: string
  readonly source: ToolSource
  /**
   * Phase G Task 4.5: The agent name of the caller. When set, the invoke path
   * checks `meta.ownerAgent` — if the tool has an ownerAgent and the caller's
   * agentName doesn't match, the call is rejected.
   */
  readonly agentName?: string
}

/** A toolpack-provided invoker. May return sync value or Promise; rejects propagate. */
export type ToolInvoker = (
  args: Record<string, unknown>,
  ctx: InvokeContext,
) => unknown | Promise<unknown>

interface RegistryEntry {
  readonly meta: ToolMeta
  readonly invoker: ToolInvoker
}

// ─── Internal state ──────────────────────────────────────────────────

const entries = new Map<string, RegistryEntry>()

// ─── Public API ──────────────────────────────────────────────────────

const get = (name: string): ToolMeta | undefined => entries.get(name)?.meta

const has = (name: string): boolean => entries.has(name)

const list = (opts: ListOptions = {}): ReadonlyArray<ToolMeta> => {
  let result: ToolMeta[] = []
  for (const e of entries.values()) result.push(e.meta)
  if (opts.category) {
    result = result.filter((t) => t.category === opts.category)
  }
  if (opts.source) {
    const src = opts.source
    result = result.filter((t) => t.defaultAllowedSources.includes(src))
  }
  if (opts.riskLevel) {
    result = result.filter((t) => t.riskLevel === opts.riskLevel)
  }
  return result
}

/** Phase F Task 1.7: list all tools in a given category. */
const listByCategory = (category: ToolCategory): ReadonlyArray<ToolMeta> => {
  const result: ToolMeta[] = []
  for (const e of entries.values()) {
    if (e.meta.category === category) result.push(e.meta)
  }
  return result
}

/** Phase G Task 4.6: list all tools owned by a specific agent. */
const listByOwnerAgent = (agentName: string): ReadonlyArray<ToolMeta> => {
  const result: ToolMeta[] = []
  for (const e of entries.values()) {
    if (e.meta.ownerAgent === agentName) result.push(e.meta)
  }
  return result
}

const allowed = (name: string, source: ToolSource): boolean => {
  const e = entries.get(name)
  if (!e) return false
  return e.meta.defaultAllowedSources.includes(source)
}

/**
 * Assert that `source` may use `name`. Throws `Error` whose `message` carries
 * the canonical HSAS error code so callers can surface a stable code.
 */
const assertAllowed = (name: string, source: ToolSource): void => {
  const e = entries.get(name)
  if (!e) {
    throw new Error(`UNKNOWN_TOOL: tool "${name}" is not registered in TOOL_REGISTRY`)
  }
  if (!e.meta.defaultAllowedSources.includes(source)) {
    throw new Error(
      `TOOL_NOT_PERMITTED_FOR_SOURCE: tool "${name}" is not allowed for source "${source}". ` +
        `Allowed sources: [${e.meta.defaultAllowedSources.join(", ")}]`,
    )
  }
}

/**
 * Register a tool's metadata together with its invoker. Toolpacks call this
 * during their `register(toolRegistry)` lifecycle. Throws:
 *   - `TOOL_INVOKER_MISSING` when `invoker` is not a function
 *   - `DUPLICATE_TOOL_NAME` when `meta.name` is already registered
 *   - `NetworkToolMustGatePermission` when a network-category tool allows
 *     user source but doesn't declare `requiresPermissionPrompt: true`
 *   - `ControlToolMustBeBuiltinOnly` when a control-category tool allows
 *     non-builtin sources (Phase G Task 4.3)
 *   - `MessagingToolMustGatePermission` when a messaging-category tool allows
 *     user source but doesn't declare `requireApproval: true` (Phase G Task 4.4)
 */
const register = (meta: ToolMeta, invoker: ToolInvoker): void => {
  if (typeof invoker !== "function") {
    throw new Error(
      `TOOL_INVOKER_MISSING: tool "${meta.name}" registration requires a function invoker`,
    )
  }
  if (entries.has(meta.name)) {
    throw new Error(`DUPLICATE_TOOL_NAME: tool "${meta.name}" already registered`)
  }
  // Phase F Task 1.6: network-category tools that allow user source MUST
  // declare requiresPermissionPrompt to prevent silent network access.
  if (
    meta.category === "network" &&
    meta.defaultAllowedSources.includes("user") &&
    !meta.requiresPermissionPrompt
  ) {
    throw new Error(
      `NetworkToolMustGatePermission: network tool "${meta.name}" allows user source ` +
        `but does not declare requiresPermissionPrompt: true. This is required to prevent ` +
        `silent network access from user-authored agents.`,
    )
  }
  // Phase G Task 4.3: control-category tools MUST be builtin-only.
  // These tools (activate_capability, delegate_to_subagent) can change the
  // runtime's active agent/capability — only platform-trusted code may invoke them.
  if (
    meta.category === "control" &&
    meta.defaultAllowedSources.some((s) => s !== "builtin")
  ) {
    throw new Error(
      `ControlToolMustBeBuiltinOnly: control tool "${meta.name}" must only allow ` +
        `builtin source. Control tools can change runtime state and must not be ` +
        `accessible to user-authored or marketplace agents.`,
    )
  }
  // Phase G Task 4.4: messaging-category tools that allow user source MUST
  // declare requireApproval to prevent unsanctioned outbound messages.
  if (
    meta.category === "messaging" &&
    meta.defaultAllowedSources.includes("user") &&
    !meta.requireApproval
  ) {
    throw new Error(
      `MessagingToolMustGatePermission: messaging tool "${meta.name}" allows user source ` +
        `but does not declare requireApproval: true. Messaging tools that send external ` +
        `messages must require explicit user approval when used by non-builtin agents.`,
    )
  }
  entries.set(meta.name, { meta, invoker })
}

/**
 * Invoke a registered tool. The single L2→L1 call channel.
 *
 * Validation order (fail-fast):
 *   1. `ctx.sessionId` non-empty            → MISSING_SESSION_ID
 *   2. tool exists                          → UNKNOWN_TOOL
 *   3. source allowed for tool              → TOOL_NOT_PERMITTED_FOR_SOURCE
 *   4. ownerAgent guard (Phase G Task 4.5)  → TOOL_OWNER_AGENT_MISMATCH
 *   5. invoker present                      → TOOL_INVOKER_MISSING (defensive)
 *   6. then call invoker; sync values are wrapped via Promise.resolve.
 */
const invoke = async (
  name: string,
  args: Record<string, unknown>,
  ctx: InvokeContext,
): Promise<unknown> => {
  if (!ctx || typeof ctx.sessionId !== "string" || ctx.sessionId.length === 0) {
    throw new Error(`MISSING_SESSION_ID: invoke("${name}", …) requires ctx.sessionId`)
  }
  const e = entries.get(name)
  if (!e) {
    throw new Error(`UNKNOWN_TOOL: tool "${name}" is not registered in TOOL_REGISTRY`)
  }
  if (!e.meta.defaultAllowedSources.includes(ctx.source)) {
    throw new Error(
      `TOOL_NOT_PERMITTED_FOR_SOURCE: tool "${name}" is not allowed for source "${ctx.source}". ` +
        `Allowed sources: [${e.meta.defaultAllowedSources.join(", ")}]`,
    )
  }
  // Phase G Task 4.5: ownerAgent guard — if the tool declares an ownerAgent,
  // only that agent may invoke it. Other agents are rejected.
  if (e.meta.ownerAgent && ctx.agentName && ctx.agentName !== e.meta.ownerAgent) {
    throw new Error(
      `TOOL_OWNER_AGENT_MISMATCH: tool "${name}" is owned by agent "${e.meta.ownerAgent}" ` +
        `but was invoked by agent "${ctx.agentName}". Only the owner agent may use this tool.`,
    )
  }
  if (typeof e.invoker !== "function") {
    throw new Error(`TOOL_INVOKER_MISSING: tool "${name}" has no invoker`)
  }
  return Promise.resolve(e.invoker(args, ctx))
}

/**
 * Convert all registered tools that have a `parameters` schema into
 * `ToolDefinition[]` ready for `ToolRuntime.stream`.
 *
 * This is the **single conversion path** from `toolRegistry` → `ToolRuntime`.
 * `session.ts` MUST use this method instead of hand-rolling `ToolDefinition`
 * objects for platform tools — doing so would create a second source of truth
 * for parameter schemas.
 *
 * Special handling:
 * - `list_dir`: normalises the `dir_path` alias → `path` before invoking,
 *   for compatibility with LLM providers that use non-standard field names
 *   (e.g. Volcengine/Doubao true-machine payload uses `dir_path`).
 *
 * @param sessionId - The session ID passed to every `invoke` call as `ctx.sessionId`.
 */
const toToolDefinitions = (sessionId: string): Array<{
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
}> => {
  const result: Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
    execute: (args: Record<string, unknown>) => Promise<unknown>
  }> = []

  for (const e of entries.values()) {
    const { meta, invoker } = e
    if (!meta.parameters) continue // internal-only tools (sandbox_create etc.) are skipped

    const toolName = meta.name
    result.push({
      name: toolName,
      description: meta.description,
      parameters: meta.parameters as Record<string, unknown>,
      execute: async (args: Record<string, unknown>) => {
        // Normalise known field-name aliases before invoking.
        // list_dir: some LLM providers (e.g. Doubao/Volcengine) emit `dir_path`
        // instead of the canonical `path` field.
        let normalizedArgs = args
        if (toolName === "list_dir" && !args.path && args.dir_path) {
          normalizedArgs = { ...args, path: args.dir_path }
          const { dir_path: _, ...rest } = normalizedArgs
          normalizedArgs = rest
        }
        return invoke(toolName, normalizedArgs, { sessionId, source: "builtin" })
      },
    })
  }

  return result
}

/**
 * Register a sandbox session for the given `sessionId` so that platform tools
 * (fs / parse / export) can pass the Rust `fs_guard` check.
 *
 * **Architectural contract** (跨层契约纪律 §sandbox-lifecycle):
 *
 * Any caller that uses `toToolDefinitions(sessionId)` to expose platform tools
 * to `ToolRuntime` MUST call `createSandboxSession(sessionId)` before the first
 * tool invocation, and MUST call `dropSandboxSession(sessionId)` in a `finally`
 * block after the run completes (success / failure / abort).
 *
 * Failure to do so will cause every platform tool call to fail with
 * `SANDBOX_SESSION_NOT_FOUND`.
 *
 * Implementation note: uses `source: "builtin"` which fast-paths all sandbox
 * path checks — no whitelist configuration is needed for built-in sessions.
 * The call is idempotent: if the session is already registered (e.g. on retry),
 * the error is silently swallowed.
 */
const createSandboxSession = async (sessionId: string): Promise<void> => {
  const e = entries.get("sandbox_create")
  if (!e) return // sandbox_create not registered (test environments without Tauri)
  await Promise.resolve(e.invoker({ session_id: sessionId, source: "builtin" }, { sessionId, source: "builtin" })).catch(
    () => undefined, // idempotent — already registered is fine
  )
}

/**
 * Drop the sandbox session registered by `createSandboxSession`.
 *
 * MUST be called in a `finally` block after every `ToolRuntime.stream` run
 * that was preceded by `createSandboxSession`. Errors are silently swallowed —
 * a missing session on drop is harmless (the session may have already expired).
 *
 * See `createSandboxSession` for the full architectural contract.
 */
const dropSandboxSession = async (sessionId: string): Promise<void> => {
  const e = entries.get("sandbox_drop")
  if (!e) return // sandbox_drop not registered (test environments without Tauri)
  await Promise.resolve(e.invoker({ session_id: sessionId }, { sessionId, source: "builtin" })).catch(
    () => undefined,
  )
}

/** Test-only helper: register meta with a default no-op invoker. */
const registerForTest = (meta: ToolMeta, invoker?: ToolInvoker): void => {
  const fn: ToolInvoker = invoker ?? (() => undefined)
  // Allow overwrite for test fixtures.
  entries.set(meta.name, { meta, invoker: fn })
}

/** Test-only helper: undo a `registerForTest` insertion. */
const unregisterForTest = (name: string): boolean => entries.delete(name)

/** Test-only helper: clear the entire registry (used between integration tests). */
const clearForTest = (): void => entries.clear()

export const toolRegistry = {
  get,
  has,
  list,
  listByCategory,
  listByOwnerAgent,
  allowed,
  assertAllowed,
  register,
  invoke,
  toToolDefinitions,
  createSandboxSession,
  dropSandboxSession,
  /** @internal — tests only. */
  registerForTest,
  /** @internal — tests only. */
  unregisterForTest,
  /** @internal — tests only. */
  clearForTest,
} as const
export type ToolRegistry = typeof toolRegistry

// ─────────────────────────────────────────────────────────────────────────────
// Effect Layer wrapper (Phase B Decision: ADR-005 surface)
//
// Two ways to consume `toolRegistry`:
//   1. Direct singleton import — used by toolpacks, bootstrap and legacy code.
//      `import { toolRegistry } from "@/platform/registry/toolRegistry"`
//   2. Effect DI via `ToolRegistryService` Tag — used inside `agent-runtime`
//      Effect graphs where a stub is desirable for unit tests.
//      `Effect.gen(function*() { const reg = yield* ToolRegistryService; ... })`
//
// Both paths share the **same** in-memory `entries` Map, so registrations done
// via the singleton are visible through the Layer and vice-versa.
// ─────────────────────────────────────────────────────────────────────────────

import { Context, Layer } from "effect"

export class ToolRegistryService extends Context.Service<
  ToolRegistryService,
  ToolRegistry
>()("platform/ToolRegistryService") {}

/** Live Layer — backed by the module singleton (single source of truth). */
export const ToolRegistryServiceLive: Layer.Layer<ToolRegistryService> = Layer.succeed(
  ToolRegistryService,
  toolRegistry,
)
