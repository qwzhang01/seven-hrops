/**
 * AgentLoader — turns an HSAS AgentManifest into a runtime `Agent.Info` and
 * registers it into `Agent.Service`.
 *
 * Spec reference:
 *   - openspec/changes/platform-foundation-mvb/specs/agent-loader/spec.md
 *   - doc/agent-architecture/15-平台底座实现指南.md §五
 *
 * Pipeline:
 *   1. validate     — `manifestValidator.validate(raw, ctx)`
 *   2. authorise    — for each tool in `spec.tools.allowed`, run
 *                     `toolRegistry.assertAllowed(tool, source)`
 *   3. transform    — `manifestToAgentInfo(manifest)`
 *   4. register     — `agentService.register(info)`
 *
 * Reverse path (`unload`) calls `agentService.unregister(name)`.
 *
 * The `reload` helper is shorthand for `unload(name) → load(manifest)` and
 * is mostly useful for hot-reloading user-authored agents in dev.
 */

import { Effect } from "effect"
import { parse as parseYaml } from "yaml"

import { Agent, type Info as AgentInfo } from "../../agent-runtime/agent/agent"
import {
  validate,
  ValidationError,
  type ValidationContext,
} from "../hsas/validator"
import { toolRegistry, type ToolSource } from "../registry/toolRegistry"
import { type AgentManifest, type AnyManifest } from "../hsas/schema"

// ─── Pure transform ──────────────────────────────────────────────────

/**
 * Build a runtime `Agent.Info` from a validated `AgentManifest`.
 *
 * Conversion rules:
 *   - `metadata.name` → `info.name`
 *   - `metadata.description` → `info.description`
 *   - `spec.mode` → `info.mode`
 *   - `spec.basePrompt` (+ optional `\n\n${contextTemplate}`) → `info.prompt`
 *   - `spec.tools.allowed` → `info.tools` (string list)
 *   - `spec.model` → `info.model` (only `provider`/`modelID`/`temperature`)
 *   - `spec.permission` → `info.permission`. When the Manifest does not
 *     supply any permission rules we fall back to a *source-derived default*:
 *
 *       * `builtin`     → allow-all (`{ permission: "*", pattern: "*", action: "allow" }`)
 *       * `user`        → ask-before for any tool (`action: "ask"`)
 *       * `marketplace` → ask-before for any tool (`action: "ask"`)
 *
 *     This guarantees `info.permission` is always a non-empty array, which
 *     keeps the downstream `Permission.evaluate` code path branch-free.
 */
export const manifestToAgentInfo = (m: AgentManifest): AgentInfo => {
  const prompt = m.spec.contextTemplate
    ? `${m.spec.basePrompt}\n\n${m.spec.contextTemplate}`
    : m.spec.basePrompt

  const permission =
    m.spec.permission && m.spec.permission.length > 0
      ? m.spec.permission.map((r) => ({ ...r }))
      : defaultPermissionForSource(m.metadata.source)

  return {
    name: m.metadata.name,
    description: m.metadata.description,
    mode: m.spec.mode,
    prompt,
    tools: [...m.spec.tools.allowed],
    permission,
    ...(m.spec.model
      ? {
          model: { providerID: m.spec.model.provider, modelID: m.spec.model.modelID },
          ...(m.spec.model.temperature !== undefined
            ? { temperature: m.spec.model.temperature }
            : {}),
        }
      : {}),
  }
}

const defaultPermissionForSource = (
  source: ToolSource,
): AgentInfo["permission"] => {
  if (source === "builtin") {
    return [{ permission: "*", pattern: "*", action: "allow" }]
  }
  return [{ permission: "*", pattern: "*", action: "ask" }]
}

// ─── AgentLoader ─────────────────────────────────────────────────────

export interface LoadOptions {
  /**
   * Optional ValidationContext override. Useful in tests where caller wants
   * to inject custom registry predicates. The defaults wire `toolExists`,
   * `toolAllowedForSource` and `agentExists` to the corresponding live
   * registries.
   */
  readonly validationContext?: ValidationContext
}

const buildDefaultContext = (
  agentService: Agent.Service["Type"],
): Effect.Effect<ValidationContext> =>
  Effect.gen(function* () {
    return {
      toolExists: (t: string) => toolRegistry.has(t),
      toolAllowedForSource: (t: string, s: ToolSource) =>
        toolRegistry.allowed(t, s),
      agentExists: (name: string) => {
        // We can't await Effect synchronously in a predicate, so this is a
        // best-effort check using the registry's mutable map. In practice
        // bootstrap is single-threaded and this works.
        const has = (agentService as unknown as { _hasSync?: (n: string) => boolean })
        return has._hasSync ? has._hasSync(name) : false
      },
    } satisfies ValidationContext
  })

/**
 * Load a single AgentManifest into the runtime.
 *
 * @returns the `Agent.Info` that was registered.
 *
 * @throws  ValidationError on schema/business-rule failure.
 * @throws  Error (with HSAS code in message) when the tool authorisation
 *          gate rejects the manifest.
 */
export const load = (
  raw: unknown,
  opts: LoadOptions = {},
): Effect.Effect<AgentInfo, ValidationError | Error, Agent.Service> =>
  Effect.gen(function* () {
    const agentService = yield* Agent.Service

    // 1. validate (with a context that resolves predicates against live regs)
    const ctx: ValidationContext = opts.validationContext ?? {
      toolExists: (t: string) => toolRegistry.has(t),
      toolAllowedForSource: (t: string, s: ToolSource) => toolRegistry.allowed(t, s),
    }
    const manifest = (yield* validate(raw, ctx)) as AnyManifest
    if (manifest.kind !== "Agent") {
      throw new ValidationError(
        "INVALID_KIND",
        `agentLoader received a manifest with kind="${manifest.kind}"`,
      )
    }
    const am = manifest as AgentManifest

    // 2. authorise tools (defence-in-depth — Validator already did this when a
    //    `toolAllowedForSource` predicate was present, but we run it here
    //    again so even a context with the predicate stripped still fails closed).
    for (const tool of am.spec.tools.allowed) {
      toolRegistry.assertAllowed(tool, am.metadata.source)
    }

    // 3. transform
    const info = manifestToAgentInfo(am)

    // 4. register
    yield* agentService.register(info)

    return info
  })

/**
 * Load multiple manifests in order. Aborts on the first failure (no
 * partial-success rollback in MVB — bootstrap is all-or-nothing).
 */
export const loadMany = (
  raws: ReadonlyArray<unknown>,
  opts: LoadOptions = {},
): Effect.Effect<ReadonlyArray<AgentInfo>, ValidationError | Error, Agent.Service> =>
  Effect.gen(function* () {
    const out: AgentInfo[] = []
    for (const raw of raws) {
      out.push(yield* load(raw, opts))
    }
    return out
  })

/**
 * Unload a previously-loaded agent.
 */
export const unload = (
  name: string,
): Effect.Effect<void, Error, Agent.Service> =>
  Effect.gen(function* () {
    const agentService = yield* Agent.Service
    yield* agentService.unregister(name)
  })

/**
 * Reload = unload(name) → load(raw). Useful for hot-reloading user agents.
 */
export const reload = (
  name: string,
  raw: unknown,
  opts: LoadOptions = {},
): Effect.Effect<AgentInfo, ValidationError | Error, Agent.Service> =>
  Effect.gen(function* () {
    yield* unload(name)
    return yield* load(raw, opts)
  })

/**
 * Convenience wrapper: parse YAML text then call `load`. Lets bootstrap
 * and hot-reload UI feed in raw `*.yaml` content without each caller
 * re-implementing YAML parsing.
 *
 * Throws `ValidationError("YAML_PARSE_FAILED", ...)` on malformed YAML.
 */
export const loadFromYaml = (
  yamlText: string,
  opts: LoadOptions = {},
): Effect.Effect<AgentInfo, ValidationError | Error, Agent.Service> =>
  Effect.gen(function* () {
    let raw: unknown
    try {
      raw = parseYaml(yamlText)
    } catch (e) {
      throw new ValidationError(
        "YAML_PARSE_FAILED",
        `agentLoader.loadFromYaml: ${(e as Error).message}`,
      )
    }
    return yield* load(raw, opts)
  })

export const agentLoader = { load, loadMany, loadFromYaml, unload, reload, manifestToAgentInfo } as const
export type AgentLoader = typeof agentLoader

// Suppress an unused-import warning when the `buildDefaultContext` helper
// is not yet wired in MVB (kept here for future SkillLoader alignment).
void buildDefaultContext
