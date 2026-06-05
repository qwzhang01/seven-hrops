/**
 * Platform bootstrap — the single entry-point that turns a freshly-started
 * runtime into a fully-loaded HSAS platform.
 *
 * Spec reference:
 *   - openspec/changes/consolidate-platform-runtime/specs/builtin-seed-bootstrap/spec.md
 *   - openspec/changes/consolidate-platform-runtime/specs/platform-foundation/spec.md
 *
 * Boot order (deterministic, fail-fast):
 *
 *   0. Build a long-lived `ManagedRuntime` from the FULL `createAppLayer`
 *      (Agent + Skill + Provider + MCP + Config + Session + Bus +
 *      Permission + Plugin + Observability + SessionProcessor +
 *      SessionPrompt + EffectBridge + InstanceState). The runtime is the
 *      *only* place runtime services live — both bootstrap, the React side
 *      and services share the same runtime via `window.__platform.runtime`.
 *      After the runtime is up, we best-effort register the in-process MCP
 *      server (failure is warning, not fatal).
 *   1. Skills first  (Agents may reference Skills by name).
 *   2. Agents second (Capabilities reference Agents by name).
 *   3. Capabilities last (UI entry-point cards).
 *   4. Expose `window.__platform` for the React side / services /
 *      ChatWorkspace.
 *
 * Any failure in step 1–3 aborts the whole sequence, disposes the runtime,
 * and rejects the returned promise. Step 0's MCP registration is the only
 * exception — its failure is logged and swallowed.
 *
 * Callers are expected to render a fallback UI when the promise rejects;
 * see `main.tsx`.
 */

import { Effect, Layer, ManagedRuntime } from "effect"

import { createAppLayer } from "../agent-runtime/core/app-runtime"
import type { AgentRuntimeConfig } from "../agent-runtime/config"
import { Agent } from "../agent-runtime/agent/agent"
import { Skill } from "../agent-runtime/skill/index"
import { agentLoader } from "./loader/agentLoader"
import { skillLoader } from "./loader/skillLoader"
import { capabilityRegistry } from "./registry/capabilityRegistry"
import { toolRegistry, ToolRegistryServiceLive } from "./registry/toolRegistry"
import {
  BUILTIN_AGENT_SEEDS,
  BUILTIN_CAPABILITY_SEEDS,
  BUILTIN_SKILL_SEEDS,
  type BuiltinAgentSeed,
  type BuiltinCapabilitySeed,
  type BuiltinSkillSeed,
} from "./builtinSeed"
import { registerEmbeddedMCPServer } from "./runtimeConfig"

// ─── Runtime ─────────────────────────────────────────────────────────

/**
 * Create a fresh ManagedRuntime owning the full agent-runtime AppLayer.
 *
 * IMPORTANT: We deliberately delegate composition to `createAppLayer` —
 * that function carries non-trivial knowledge about Config / Provider /
 * Session layer ordering (see comments in app-runtime.ts). Re-implementing
 * the composition here would duplicate that fragile knowledge.
 */
export const createPlatformRuntime = (
  runtimeConfig?: Partial<AgentRuntimeConfig>,
) => {
  const appLayer = createAppLayer(runtimeConfig)
  // Merge platform-level services on top of the agent-runtime app layer so
  // that Effect graphs running inside the runtime can `yield* ToolRegistryService`
  // without needing to import platform internals (preserves L3→L2 boundary).
  const fullLayer = Layer.merge(appLayer, ToolRegistryServiceLive)
  return ManagedRuntime.make(
    fullLayer as Parameters<typeof ManagedRuntime.make>[0],
  )
}

export type PlatformRuntime = ReturnType<typeof createPlatformRuntime>

// ─── Bootstrap result ────────────────────────────────────────────────

export interface PlatformAPI {
  /**
   * Live runtime reference. May be reassigned by `reload()`; do not cache
   * — always read `window.__platform?.runtime` at call time.
   */
  runtime: PlatformRuntime
  readonly agentLoader: typeof agentLoader
  readonly skillLoader: typeof skillLoader
  readonly capabilityRegistry: typeof capabilityRegistry
  readonly toolRegistry: typeof toolRegistry
  /**
   * Hot-swap the runtime with a new configuration. Used by aiStore when
   * the user changes provider / model / API key in Settings.
   *
   * Semantics:
   *  - Concurrent calls are serialised: while a reload is in flight, a
   *    second call awaits the first before starting its own swap.
   *  - "Build new before tearing down old": the new runtime is fully
   *    loaded and `runtime` is reassigned BEFORE the old runtime is
   *    disposed, so callers reading `runtime` mid-swap never see undefined.
   */
  reload: (newConfig: AgentRuntimeConfig) => Promise<void>
}

declare global {
  interface Window {
    __platform?: PlatformAPI
  }
}

let activePlatformAPI: PlatformAPI | null = null

/**
 * Return the current platform API after a successful bootstrap.
 *
 * Business code must use this module-level reference instead of relying on
 * `window.__platform`, because production / desktop builds intentionally may
 * not expose internals on the global window object.
 */
export const getPlatformAPI = (): PlatformAPI | null => {
  if (activePlatformAPI) return activePlatformAPI
  if (typeof window !== "undefined" && window.__platform) {
    return window.__platform
  }
  return null
}

/** Return the current live runtime, or null before bootstrap completes. */
export const getPlatformRuntime = (): PlatformRuntime | null =>
  getPlatformAPI()?.runtime ?? null

// ─── Bootstrap ───────────────────────────────────────────────────────

export interface BootstrapOptions {
  /**
   * Runtime configuration consumed by `createAppLayer`. Optional in tests
   * (an empty config still produces a working — if minimal — runtime).
   */
  readonly runtimeConfig?: AgentRuntimeConfig
  /** Test-only override for the agent seed list. */
  readonly agentSeeds?: ReadonlyArray<BuiltinAgentSeed>
  /** Test-only override for the skill seed list. */
  readonly skillSeeds?: ReadonlyArray<BuiltinSkillSeed>
  /** Test-only override for the capability seed list. */
  readonly capabilitySeeds?: ReadonlyArray<BuiltinCapabilitySeed>
  /**
   * When true (default in production), `window.__platform` is assigned at
   * the end of a successful bootstrap. Tests typically pass `false`.
   */
  readonly exposeOnWindow?: boolean
  /**
   * When true, `capabilityRegistry.resetForTest()` is called before
   * installing capabilities. Defaults to false.
   */
  readonly resetCapabilities?: boolean
  /**
   * Test-only: skip the embedded MCP server registration entirely. In
   * production this is always attempted (failure is non-fatal).
   */
  readonly skipMCPRegistration?: boolean
}

/**
 * Load all builtin Skill / Agent / Capability seeds (yaml + optional
 * sidecar) into the given runtime + capability registry. Extracted so
 * that both `bootstrapPlatform` and `reload` can reuse the exact same
 * loading sequence.
 *
 * Seed inputs are raw YAML strings (with optional sidecar markdown for
 * skills) so that we exercise the same `loadFromYaml` /
 * `installFromYaml` codepath as marketplace imports do at runtime — the
 * 5.x YAML_PARSE_FAILED contract is therefore enforced in production,
 * not just in unit tests.
 */
async function loadBuiltinsInto(
  runtime: PlatformRuntime,
  opts: {
    skillsToLoad: ReadonlyArray<BuiltinSkillSeed>
    agentsToLoad: ReadonlyArray<BuiltinAgentSeed>
    capabilitiesToLoad: ReadonlyArray<BuiltinCapabilitySeed>
    resetCapabilities?: boolean
  },
): Promise<void> {
  // 1. Skills (must complete before Agents, Validator's UNKNOWN_SKILL
  //    requires Skills to be present). We feed YAML + sidecar so the
  //    5.7 sidecar-precedence rule is exercised in the production path.
  for (const seed of opts.skillsToLoad) {
    await runtime.runPromise(
      skillLoader.loadFromYaml(seed.yaml, seed.sidecar),
    )
  }

  // Build a snapshot of skill names so the Agent stage's Validator can
  // raise UNKNOWN_SKILL when an Agent references something we did not
  // load. This is what guarantees boot order is enforced.
  const skillNames = new Set<string>(
    await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* Skill.Service
        const list = yield* svc.all()
        return list.map((s) => s.name)
      }),
    ),
  )

  // 2. Agents (must complete before Capabilities, Validator's
  //    AGENT_NOT_FOUND requires Agents to be present).
  for (const seed of opts.agentsToLoad) {
    await runtime.runPromise(
      agentLoader.loadFromYaml(seed.yaml, {
        validationContext: {
          toolExists: (t) => toolRegistry.has(t),
          toolAllowedForSource: (t, s) => toolRegistry.allowed(t, s),
          skillExists: (n) => skillNames.has(n),
        },
      }),
    )
  }

  // 3. Capabilities (UI entry-point cards). Optionally reset so a second
  //    bootstrap call in the same JS context starts from a clean slate.
  if (opts.resetCapabilities) {
    capabilityRegistry.resetForTest()
  }
  const agentNames = new Set<string>(
    await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* Agent.Service
        const list = yield* svc.list()
        return list.map((a) => a.name)
      }),
    ),
  )
  for (const seed of opts.capabilitiesToLoad) {
    capabilityRegistry.installFromYaml(seed.yaml, {
      validationContext: {
        agentExists: (n) => agentNames.has(n),
        knownContextKeys: new Set(["workspacePath", "jdContent", "projectId", "candidateId", "jdId"]),
      },
    })
  }
}

/**
 * Run the bootstrap pipeline. Returns the new `PlatformAPI`.
 *
 * @throws  the underlying ValidationError / Error if any step fails. The
 *          runtime is disposed before re-throwing so we don't leak fibers.
 */
export const bootstrapPlatform = async (
  opts: BootstrapOptions = {},
): Promise<PlatformAPI> => {
  const skillsToLoad = opts.skillSeeds ?? BUILTIN_SKILL_SEEDS
  const agentsToLoad = opts.agentSeeds ?? BUILTIN_AGENT_SEEDS
  const capabilitiesToLoad =
    opts.capabilitySeeds ?? BUILTIN_CAPABILITY_SEEDS
  // 6.4: only expose the live registry on `window.__platform` outside of
  // production. In a packaged Tauri build leaking the registry to the
  // window object would let any in-page script bypass source whitelists
  // by calling `toolRegistry.invoke` directly. Dev / test environments
  // need it for E2E inspection.
  const isDevOrTest =
    import.meta.env?.DEV === true || import.meta.env?.MODE === "test"
  const exposeOnWindow = (opts.exposeOnWindow ?? true) && isDevOrTest

  // Step 0: Build the full runtime. Then best-effort MCP registration.
  const runtime = createPlatformRuntime(opts.runtimeConfig)

  if (!opts.skipMCPRegistration) {
    // Failure is non-fatal: in browser dev mode `getDb()` cannot load
    // better-sqlite3, but the rest of the runtime (LLM chat) is still
    // usable. `registerEmbeddedMCPServer` already swallows + warns.
    await registerEmbeddedMCPServer(runtime)
  }

  try {
    await loadBuiltinsInto(runtime, {
      skillsToLoad,
      agentsToLoad,
      capabilitiesToLoad,
      resetCapabilities: opts.resetCapabilities,
    })
  } catch (e) {
    await runtime.dispose()
    throw e
  }

  // ─── Reload state (closure-captured) ────────────────────────────────
  let currentRuntime: PlatformRuntime = runtime
  let reloadInflight: Promise<void> | null = null

  const performReload = async (newConfig: AgentRuntimeConfig): Promise<void> => {
    const next = createPlatformRuntime(newConfig)

    if (!opts.skipMCPRegistration) {
      await registerEmbeddedMCPServer(next)
    }

    try {
      await loadBuiltinsInto(next, {
        skillsToLoad,
        agentsToLoad,
        capabilitiesToLoad,
        // Always reset on reload — we're rebuilding from scratch and want
        // capabilityRegistry to mirror the fresh runtime, not stack on top
        // of the old one.
        resetCapabilities: true,
      })
    } catch (e) {
      // New runtime failed to load — keep the old one alive so the app
      // doesn't go dark. Surface the error to the caller.
      await next.dispose()
      throw e
    }

    // Build-new-before-tear-down-old: swap the live reference first,
    // then dispose the old runtime asynchronously.
    const old = currentRuntime
    currentRuntime = next
    api.runtime = next
    if (activePlatformAPI === api) {
      activePlatformAPI.runtime = next
    }
    if (typeof window !== "undefined" && window.__platform === api) {
      window.__platform.runtime = next
    }
    // Fire-and-forget dispose. We don't await: in-flight effects on the
    // old runtime get interrupted, which is the desired semantics.
    void old.dispose().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[bootstrap] old runtime dispose failed:", err)
    })
  }

  const reload = async (newConfig: AgentRuntimeConfig): Promise<void> => {
    // Serialise concurrent reloads. If a reload is in flight, queue
    // behind it so the latest config wins deterministically.
    if (reloadInflight) {
      await reloadInflight.catch(() => {
        /* swallow — caller of the previous reload already handled it */
      })
    }
    const promise = performReload(newConfig)
    reloadInflight = promise.finally(() => {
      if (reloadInflight === promise) {
        reloadInflight = null
      }
    })
    await reloadInflight
  }

  const api: PlatformAPI = {
    runtime,
    agentLoader,
    skillLoader,
    capabilityRegistry,
    toolRegistry,
    reload,
  }
  activePlatformAPI = api
  if (exposeOnWindow && typeof window !== "undefined") {
    window.__platform = api
  }
  return api
}

/**
 * Tear down a previously bootstrapped platform. Used by tests and HMR.
 */
export const teardownPlatform = async (api: PlatformAPI): Promise<void> => {
  if (activePlatformAPI === api) {
    activePlatformAPI = null
  }
  if (typeof window !== "undefined" && window.__platform === api) {
    delete window.__platform
  }
  await api.runtime.dispose()
}
