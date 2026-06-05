/**
 * HSAS Manifest Validator
 *
 * Two-stage validation:
 *
 *   Stage 1 — Static schema decode (Schema.decodeUnknownSync). Maps any
 *             ParseError to the standard HSAS error codes.
 *
 *   Stage 2 — Business rules that go beyond what Schema can express:
 *             cross-field invariants (e.g. tools.allowed × source), registry
 *             lookups (UNKNOWN_TOOL / UNKNOWN_SKILL / AGENT_NOT_FOUND), name
 *             reservation rules, and various size / config limits.
 *
 * The 19 HSAS error codes (per HSAS Spec §十一) are mapped here and exhaustively
 * exercised in `manifestValidator.test.ts`.
 *
 * Cross-cutting design:
 *
 *   - The validator is a *pure function* that takes a ValidationContext
 *     describing the registries (and other ambient state) it should use to
 *     resolve names. This keeps the validator testable without spinning up
 *     the entire platform layer.
 *
 *   - We surface failures as `Effect.fail(ValidationError)` so callers can
 *     compose them via `Effect.flatMap` etc. A synchronous wrapper
 *     `validateSync` is provided for tests and bootstrap.
 */

import { Effect, Schema } from "effect"

import {
  AgentManifest,
  CapabilityManifest,
  SkillManifest,
  type AnyManifest,
} from "./schema"

// ─── Error codes (the 19 HSAS standard codes) ────────────────────────

export type ErrorCode =
  | "INVALID_API_VERSION"
  | "INVALID_KIND"
  | "INVALID_NAME"
  | "DUPLICATE_NAME"
  | "MISSING_REQUIRED_FIELD"
  | "UNKNOWN_TOOL"
  | "TOOL_NOT_PERMITTED_FOR_SOURCE"
  | "UNKNOWN_SKILL"
  | "CIRCULAR_INHERIT"
  | "CIRCULAR_SKILL_DEPENDENCY"
  | "RESOURCE_NOT_FOUND"
  | "PROMPT_TOO_SHORT"
  | "MODEL_PROVIDER_NOT_CONFIGURED"
  | "INVALID_PERMISSION_ACTION"
  | "SKILL_TOO_LARGE"
  | "AGENT_NOT_FOUND"
  | "UNKNOWN_CONTEXT_KEY"
  | "SIGNATURE_INVALID"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "YAML_PARSE_FAILED"
  | "MANIFEST_FILENAME_MISMATCH"
  | "MANIFEST_MULTIDOC_NOT_ALLOWED"
  | "ASSISTANT_TEMPERATURE_MUST_BE_ZERO"
  | "NEEDS_WORKSPACE_NOT_DECLARED"

export const ERROR_CODES: readonly ErrorCode[] = [
  "INVALID_API_VERSION",
  "INVALID_KIND",
  "INVALID_NAME",
  "DUPLICATE_NAME",
  "MISSING_REQUIRED_FIELD",
  "UNKNOWN_TOOL",
  "TOOL_NOT_PERMITTED_FOR_SOURCE",
  "UNKNOWN_SKILL",
  "CIRCULAR_INHERIT",
  "CIRCULAR_SKILL_DEPENDENCY",
  "RESOURCE_NOT_FOUND",
  "PROMPT_TOO_SHORT",
  "MODEL_PROVIDER_NOT_CONFIGURED",
  "INVALID_PERMISSION_ACTION",
  "SKILL_TOO_LARGE",
  "AGENT_NOT_FOUND",
  "UNKNOWN_CONTEXT_KEY",
  "SIGNATURE_INVALID",
  "RESOURCE_LIMIT_EXCEEDED",
  "YAML_PARSE_FAILED",
  "MANIFEST_FILENAME_MISMATCH",
  "MANIFEST_MULTIDOC_NOT_ALLOWED",
  "ASSISTANT_TEMPERATURE_MUST_BE_ZERO",
  "NEEDS_WORKSPACE_NOT_DECLARED",
] as const

// ─── ValidationError ─────────────────────────────────────────────────

export class ValidationError extends Error {
  public readonly code: ErrorCode
  public readonly detail: Record<string, unknown>

  constructor(code: ErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(`[${code}] ${message}`)
    this.name = "ValidationError"
    this.code = code
    this.detail = detail
  }
}

// ─── ValidationContext ───────────────────────────────────────────────

/**
 * Describes the ambient state the validator should consult while running
 * stage 2 (business rules).
 *
 * All fields are optional so unit tests can hand-build minimal contexts.
 * In production, `bootstrap.ts` wires this from `toolRegistry` / `Agent.Service`
 * / `Skill.Service` / `Provider.Service`.
 */
export interface ValidationContext {
  /** Predicate: does the named tool exist in ToolRegistry? */
  readonly toolExists?: (name: string) => boolean
  /** Predicate: is the tool allowed for the given source? */
  readonly toolAllowedForSource?: (
    name: string,
    source: "builtin" | "user" | "marketplace",
  ) => boolean
  /** Predicate: is a Skill with the given name already registered? */
  readonly skillExists?: (name: string) => boolean
  /** Predicate: is an Agent with the given name already registered? */
  readonly agentExists?: (name: string) => boolean
  /** Predicate: is the manifest's name already present in the corresponding registry? */
  readonly isNameDuplicate?: (kind: AnyManifest["kind"], name: string) => boolean
  /** Predicate: is the configured model provider available? */
  readonly modelProviderConfigured?: (provider: string) => boolean
  /** Predicate: does the resource path exist (filesystem check)? */
  readonly resourceExists?: (path: string) => boolean
  /** Predicate: is the marketplace signature valid? */
  readonly signatureValid?: (signature: string) => boolean
  /** Predicate: do the requested resources fit within the source's sandbox limit? */
  readonly resourcesWithinLimit?: (
    resources: AgentManifest["spec"]["resources"],
    source: "builtin" | "user" | "marketplace",
  ) => boolean
  /** Optional context keys whitelist (used by Capability validation). */
  readonly knownContextKeys?: ReadonlySet<string>
  /** Optional skill payload size in bytes (used by Skill validation). */
  readonly skillPayloadBytes?: number
  /** Inheritance lookup: returns the parent name for a given Agent name (for cycle detection). */
  readonly agentInheritParent?: (name: string) => string | undefined
  /** Skill dependency lookup: returns dependency names for cycle detection. */
  readonly skillDependencies?: (name: string) => readonly string[]
}

// ─── Reserved name prefixes ──────────────────────────────────────────

const RESERVED_PREFIXES = ["builtin-", "system-", "hsas-"] as const

// ─── Stage 1: schema decode ──────────────────────────────────────────

/**
 * Best-effort mapping from a Schema decode failure to a HSAS error code.
 *
 * The strategy is to look at the raw input *before* we call decode, and try
 * to identify the highest-priority structural problem (apiVersion, kind,
 * required fields, etc). Any leftover failure is mapped to
 * MISSING_REQUIRED_FIELD with the original Schema message attached.
 */
const preflight = (raw: unknown): ValidationError | undefined => {
  if (raw === null || typeof raw !== "object") {
    return new ValidationError(
      "MISSING_REQUIRED_FIELD",
      "manifest must be an object",
      { received: typeof raw },
    )
  }
  const m = raw as Record<string, unknown>

  if (m.apiVersion !== "hsas.seven-hrops/v1") {
    return new ValidationError(
      "INVALID_API_VERSION",
      `unrecognised apiVersion: ${String(m.apiVersion)}`,
      { received: m.apiVersion },
    )
  }
  if (m.kind !== "Agent" && m.kind !== "Skill" && m.kind !== "Capability") {
    return new ValidationError(
      "INVALID_KIND",
      `kind must be Agent | Skill | Capability, got: ${String(m.kind)}`,
      { received: m.kind },
    )
  }
  // Required: metadata + spec
  if (!m.metadata || typeof m.metadata !== "object") {
    return new ValidationError("MISSING_REQUIRED_FIELD", "metadata is required", {
      field: "metadata",
    })
  }
  if (!m.spec || typeof m.spec !== "object") {
    return new ValidationError("MISSING_REQUIRED_FIELD", "spec is required", {
      field: "spec",
    })
  }
  // Required metadata.name → check before regex (so a name-shape issue gets
  // reported as INVALID_NAME from stage-2-light below).
  const meta = m.metadata as Record<string, unknown>
  for (const required of [
    "name",
    "displayName",
    "description",
    "source",
    "version",
    "createdAt",
  ] as const) {
    if (meta[required] === undefined || meta[required] === null) {
      return new ValidationError(
        "MISSING_REQUIRED_FIELD",
        `metadata.${required} is required`,
        { field: `metadata.${required}` },
      )
    }
  }
  // If the name is a string but does not match the regex → INVALID_NAME.
  if (typeof meta.name === "string") {
    const re = /^[a-z][a-z0-9-]{2,62}[a-z0-9]$/
    if (!re.test(meta.name) || meta.name.includes("--")) {
      return new ValidationError(
        "INVALID_NAME",
        `metadata.name "${meta.name}" does not match HSAS naming rule`,
        { name: meta.name },
      )
    }
  }
  return undefined
}

const tryDecode = <A, I>(
  schema: Schema.Codec<A, I, never>,
  raw: unknown,
): { ok: true; value: A } | { ok: false; error: ValidationError } => {
  try {
    return { ok: true, value: Schema.decodeUnknownSync(schema)(raw) }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // basePrompt < 50: surface as PROMPT_TOO_SHORT
    if (/basePrompt/i.test(message) || /isMinLength.*50/i.test(message)) {
      return {
        ok: false,
        error: new ValidationError("PROMPT_TOO_SHORT", message),
      }
    }
    // permission action enum: surface as INVALID_PERMISSION_ACTION
    if (/permission/i.test(message) && /action/i.test(message)) {
      return {
        ok: false,
        error: new ValidationError("INVALID_PERMISSION_ACTION", message),
      }
    }
    return {
      ok: false,
      error: new ValidationError("MISSING_REQUIRED_FIELD", message),
    }
  }
}

// ─── Stage 2: business rules ─────────────────────────────────────────

const checkReservedPrefix = (name: string, source: string): ValidationError | undefined => {
  if (source === "builtin") return undefined
  for (const prefix of RESERVED_PREFIXES) {
    if (name.startsWith(prefix)) {
      return new ValidationError(
        "INVALID_NAME",
        `name "${name}" uses reserved prefix "${prefix}" (only allowed for builtin source)`,
        { name, prefix, source },
      )
    }
  }
  return undefined
}

const checkAgent = (m: AgentManifest, ctx: ValidationContext): ValidationError | undefined => {
  // basePrompt length is also enforced by Schema, but double-check defensively.
  if (m.spec.basePrompt.length < 50) {
    return new ValidationError("PROMPT_TOO_SHORT", "basePrompt must be at least 50 characters", {
      length: m.spec.basePrompt.length,
    })
  }

  // Permission action enum is also enforced by Schema; left here so a broken
  // Schema + Validator combination still fails closed.
  if (m.spec.permission) {
    for (const rule of m.spec.permission) {
      if (rule.action !== "allow" && rule.action !== "deny" && rule.action !== "ask") {
        return new ValidationError(
          "INVALID_PERMISSION_ACTION",
          `permission action must be allow|deny|ask, got: ${rule.action}`,
          { rule },
        )
      }
    }
  }

  // tools × ToolRegistry
  for (const tool of m.spec.tools.allowed) {
    if (ctx.toolExists && !ctx.toolExists(tool)) {
      return new ValidationError(
        "UNKNOWN_TOOL",
        `tool "${tool}" is not registered in ToolRegistry`,
        { tool },
      )
    }
    if (
      ctx.toolAllowedForSource &&
      !ctx.toolAllowedForSource(tool, m.metadata.source)
    ) {
      return new ValidationError(
        "TOOL_NOT_PERMITTED_FOR_SOURCE",
        `tool "${tool}" is not permitted for source "${m.metadata.source}"`,
        { tool, source: m.metadata.source },
      )
    }
  }

  // skills × SkillRegistry
  if (m.spec.skills) {
    for (const skillName of m.spec.skills) {
      if (ctx.skillExists && !ctx.skillExists(skillName)) {
        return new ValidationError(
          "UNKNOWN_SKILL",
          `skill "${skillName}" is not registered`,
          { skill: skillName },
        )
      }
    }
  }

  // Phase G Task 7.5: assistant agent MUST use temperature 0 for deterministic routing.
  // If the assistant agent declares a model, temperature must be exactly 0.
  if (m.metadata.name === "assistant" && m.spec.model) {
    if (m.spec.model.temperature !== undefined && m.spec.model.temperature !== 0) {
      return new ValidationError(
        "ASSISTANT_TEMPERATURE_MUST_BE_ZERO",
        `assistant agent must use temperature 0 for deterministic routing, got ${m.spec.model.temperature}`,
        { temperature: m.spec.model.temperature },
      )
    }
  }

  // model provider configured?
  if (m.spec.model && ctx.modelProviderConfigured) {
    if (!ctx.modelProviderConfigured(m.spec.model.provider)) {
      return new ValidationError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        `model provider "${m.spec.model.provider}" is not configured`,
        { provider: m.spec.model.provider },
      )
    }
  }

  // resource limit (sandbox)
  if (m.spec.resources && ctx.resourcesWithinLimit) {
    if (!ctx.resourcesWithinLimit(m.spec.resources, m.metadata.source)) {
      return new ValidationError(
        "RESOURCE_LIMIT_EXCEEDED",
        "agent resources exceed sandbox limits for its source",
        { resources: m.spec.resources, source: m.metadata.source },
      )
    }
  }

  // marketplace signature
  if (m.metadata.source === "marketplace" && ctx.signatureValid) {
    const sig = m.metadata.signature ?? ""
    if (!ctx.signatureValid(sig)) {
      return new ValidationError(
        "SIGNATURE_INVALID",
        "marketplace package signature is invalid",
        { signature: sig },
      )
    }
  }

  // inheritance cycle detection
  if (m.spec.inheritFrom && ctx.agentInheritParent) {
    const seen = new Set<string>([m.metadata.name])
    let cursor: string | undefined = m.spec.inheritFrom.name
    while (cursor) {
      if (seen.has(cursor)) {
        return new ValidationError(
          "CIRCULAR_INHERIT",
          `inheritance cycle detected involving "${cursor}"`,
          { cycle: [...seen, cursor] },
        )
      }
      seen.add(cursor)
      cursor = ctx.agentInheritParent(cursor)
    }
  }

  return undefined
}

const checkSkill = (m: SkillManifest, ctx: ValidationContext): ValidationError | undefined => {
  for (const tool of m.spec.requiredTools) {
    if (ctx.toolExists && !ctx.toolExists(tool)) {
      return new ValidationError(
        "UNKNOWN_TOOL",
        `tool "${tool}" is not registered in ToolRegistry`,
        { tool },
      )
    }
  }
  if (m.spec.requiredSkills && ctx.skillDependencies) {
    // BFS cycle detection across the skill graph
    const visited = new Set<string>([m.metadata.name])
    const queue = [...m.spec.requiredSkills]
    while (queue.length > 0) {
      const next = queue.shift()!
      if (visited.has(next)) {
        return new ValidationError(
          "CIRCULAR_SKILL_DEPENDENCY",
          `skill dependency cycle detected at "${next}"`,
          { cycle: [...visited, next] },
        )
      }
      visited.add(next)
      queue.push(...ctx.skillDependencies(next))
    }
  }
  if (m.spec.resources && ctx.resourceExists) {
    for (const res of m.spec.resources) {
      if (!ctx.resourceExists(res)) {
        return new ValidationError(
          "RESOURCE_NOT_FOUND",
          `resource "${res}" not found on disk`,
          { resource: res },
        )
      }
    }
  }
  if (typeof ctx.skillPayloadBytes === "number") {
    const limit = m.metadata.source === "builtin" ? 50 * 1024 * 1024 : 10 * 1024 * 1024
    if (ctx.skillPayloadBytes > limit) {
      return new ValidationError(
        "SKILL_TOO_LARGE",
        `skill payload (${ctx.skillPayloadBytes} bytes) exceeds limit ${limit}`,
        { bytes: ctx.skillPayloadBytes, limit, source: m.metadata.source },
      )
    }
  }
  return undefined
}

const checkCapability = (
  m: CapabilityManifest,
  ctx: ValidationContext,
): ValidationError | undefined => {
  // Task 1.4 (session-workspace-binding): capability.spec.needsWorkspace must be
  // explicitly declared as `true` or `false`. Omitting it is a lint error so that
  // authors cannot accidentally leave a new capability without a workspace policy.
  // Spec reference: openspec/changes/use_def/session-workspace-binding/tasks.md §1.4
  if (m.spec.needsWorkspace === undefined || m.spec.needsWorkspace === null) {
    return new ValidationError(
      "NEEDS_WORKSPACE_NOT_DECLARED",
      `capability "${m.metadata.name}" must explicitly declare spec.needsWorkspace: true | false`,
      { name: m.metadata.name },
    )
  }

  if (ctx.agentExists && !ctx.agentExists(m.spec.agentName)) {
    return new ValidationError(
      "AGENT_NOT_FOUND",
      `capability binds non-existent agent "${m.spec.agentName}"`,
      { agentName: m.spec.agentName },
    )
  }
  if (ctx.knownContextKeys) {
    for (const key of m.spec.contextKeys) {
      if (!ctx.knownContextKeys.has(key)) {
        return new ValidationError(
          "UNKNOWN_CONTEXT_KEY",
          `contextKey "${key}" is not registered`,
          { key },
        )
      }
    }
  }
  return undefined
}

// ─── Public API ──────────────────────────────────────────────────────

const decodeByKind = (
  kind: AnyManifest["kind"],
  raw: unknown,
):
  | { ok: true; value: AnyManifest }
  | { ok: false; error: ValidationError } => {
  if (kind === "Agent") return tryDecode(AgentManifest, raw)
  if (kind === "Skill") return tryDecode(SkillManifest, raw)
  return tryDecode(CapabilityManifest, raw)
}

/**
 * Synchronous validator. Throws a ValidationError on the first failure.
 *
 * Designed for tests / bootstrap loops where we want a flat try/catch.
 */
export const validateSync = (
  raw: unknown,
  ctx: ValidationContext = {},
): AnyManifest => {
  // Stage 0: pre-flight on raw input
  const pre = preflight(raw)
  if (pre) throw pre

  // Stage 1: schema decode
  const m = raw as Record<string, unknown>
  const decoded = decodeByKind(m.kind as AnyManifest["kind"], raw)
  if (!decoded.ok) throw decoded.error

  const manifest = decoded.value

  // Stage 2a: cross-cutting checks (apply to all kinds)
  const reserved = checkReservedPrefix(manifest.metadata.name, manifest.metadata.source)
  if (reserved) throw reserved

  if (
    ctx.isNameDuplicate &&
    ctx.isNameDuplicate(manifest.kind, manifest.metadata.name)
  ) {
    throw new ValidationError(
      "DUPLICATE_NAME",
      `${manifest.kind} with name "${manifest.metadata.name}" is already registered`,
      { kind: manifest.kind, name: manifest.metadata.name },
    )
  }

  // Stage 2b: kind-specific checks
  if (manifest.kind === "Agent") {
    const err = checkAgent(manifest, ctx)
    if (err) throw err
  } else if (manifest.kind === "Skill") {
    const err = checkSkill(manifest, ctx)
    if (err) throw err
  } else {
    const err = checkCapability(manifest, ctx)
    if (err) throw err
  }

  return manifest
}

/**
 * Effect-flavoured validator. Returns `Effect<AnyManifest, ValidationError>`.
 */
export const validate = (
  raw: unknown,
  ctx: ValidationContext = {},
): Effect.Effect<AnyManifest, ValidationError> =>
  Effect.try({
    try: () => validateSync(raw, ctx),
    catch: (e) =>
      e instanceof ValidationError
        ? e
        : new ValidationError(
            "MISSING_REQUIRED_FIELD",
            e instanceof Error ? e.message : String(e),
          ),
  })
