/**
 * HSAS Manifest Schema — v1
 *
 * Effect-based static schemas for the three HSAS kinds:
 *   - Agent
 *   - Skill
 *   - Capability
 *
 * Spec reference: doc/agent-architecture/11-HSAS-Spec.md §六.
 *
 * Design notes:
 *   - We use effect 4.0 `Schema` (not zod / json-schema) so validation is
 *     fully aligned with the rest of the agent-runtime, and decoded values
 *     are directly typed as `Schema.Schema.Type<typeof X>`.
 *   - `Schema.check(Schema.isPattern(...))` / `isMinLength` / `isMaxLength`
 *     are the effect 4.0 spelling of zod's `.regex()` / `.min()` / `.max()`.
 *   - Business rules (cross-field, registry lookups) are NOT enforced here.
 *     They live in `manifestValidator.ts` where we also map errors to the
 *     19-code error table from HSAS Spec §十一.
 */

import { Schema } from "effect"

// ─── Common scalars ──────────────────────────────────────────────────

/**
 * Manifest name — see HSAS §1.3.
 *
 *   - Length: 4..64 (regex enforces 2..62 internal chars + 1 head + 1 tail).
 *   - Lowercase letters, digits, hyphens.
 *   - Must start with a letter, end with letter/digit.
 *   - Must NOT contain consecutive hyphens (extra check below).
 *   - Must NOT use reserved prefixes `builtin-` / `system-` / `hsas-`
 *     (only enforced for `source: user|marketplace` in the Validator).
 */
export const Name = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z][a-z0-9-]{2,62}[a-z0-9]$/)),
  Schema.check(
    Schema.makeFilter(
      (s: string) => !s.includes("--"),
      { description: "name must not contain consecutive hyphens" },
    ),
  ),
)
export type Name = Schema.Schema.Type<typeof Name>

/**
 * Semantic version (e.g. "1.0.0", "1.0.0-beta.1").
 */
export const SemVer = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d+\.\d+\.\d+(-[\w.]+)?$/)),
)
export type SemVer = Schema.Schema.Type<typeof SemVer>

/**
 * Source — where this manifest comes from.
 */
export const Source = Schema.Literals(["builtin", "user", "marketplace"])
export type Source = Schema.Schema.Type<typeof Source>

/**
 * apiVersion — currently only v1 is supported.
 */
export const ApiVersion = Schema.Literals(["hsas.seven-hrops/v1"])
export type ApiVersion = Schema.Schema.Type<typeof ApiVersion>

// ─── Metadata (shared by all kinds) ──────────────────────────────────

export const Metadata = Schema.Struct({
  name: Name,
  displayName: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(64)),
  ),
  description: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(200)),
  ),
  source: Source,
  version: SemVer,
  author: Schema.optional(Schema.String),
  authorEmail: Schema.optional(Schema.String),
  icon: Schema.optional(Schema.String),
  tags: Schema.optional(
    Schema.Array(Schema.String).pipe(Schema.check(Schema.isMaxLength(10))),
  ),
  createdAt: Schema.String, // ISO 8601 — format only checked in Validator
  updatedAt: Schema.optional(Schema.String),
  deprecated: Schema.optional(Schema.Boolean),
  deprecatedReason: Schema.optional(Schema.String),
  homepage: Schema.optional(Schema.String),
  signature: Schema.optional(Schema.String),
})
export type Metadata = Schema.Schema.Type<typeof Metadata>

// ─── Permission rule (shared with agent-runtime/permission) ───────────

export const PermissionRule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Schema.Literals(["allow", "deny", "ask"]),
})
export type PermissionRule = Schema.Schema.Type<typeof PermissionRule>

// ─── Agent ───────────────────────────────────────────────────────────

const AgentMode = Schema.Literals(["primary", "subagent"])

const AgentTools = Schema.Struct({
  allowed: Schema.Array(Schema.String),
  deny: Schema.optional(Schema.Array(Schema.String)),
  autoApprove: Schema.optional(Schema.Array(Schema.String)),
})

const AgentInheritFrom = Schema.Struct({
  name: Name,
  overrides: Schema.Array(Schema.String),
})

const AgentModel = Schema.Struct({
  provider: Schema.String,
  modelID: Schema.String,
  temperature: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
  topP: Schema.optional(Schema.Number),
})

const AgentResources = Schema.Struct({
  maxTokensPerSession: Schema.optional(Schema.Number),
  maxToolCallsPerMinute: Schema.optional(Schema.Number),
  maxConcurrentSessions: Schema.optional(Schema.Number),
})

const AgentNetwork = Schema.Struct({
  allowedHosts: Schema.Array(Schema.String),
})

const AgentFilesystem = Schema.Struct({
  readPaths: Schema.optional(Schema.Array(Schema.String)),
  writePaths: Schema.optional(Schema.Array(Schema.String)),
})

const AgentCapabilityBinding = Schema.Struct({
  capabilityId: Name,
  autoCreate: Schema.optional(Schema.Boolean),
})

export const AgentSpec = Schema.Struct({
  mode: AgentMode,
  basePrompt: Schema.String.pipe(Schema.check(Schema.isMinLength(50))),
  contextTemplate: Schema.optional(Schema.String),
  contextKeys: Schema.optional(Schema.Array(Schema.String)),
  skills: Schema.optional(Schema.Array(Name)),
  inheritFrom: Schema.optional(AgentInheritFrom),
  tools: AgentTools,
  permission: Schema.optional(Schema.Array(PermissionRule)),
  model: Schema.optional(AgentModel),
  resources: Schema.optional(AgentResources),
  network: Schema.optional(AgentNetwork),
  filesystem: Schema.optional(AgentFilesystem),
  capabilityBinding: Schema.optional(AgentCapabilityBinding),
})
export type AgentSpec = Schema.Schema.Type<typeof AgentSpec>

export const AgentManifest = Schema.Struct({
  apiVersion: ApiVersion,
  kind: Schema.Literals(["Agent"]),
  metadata: Metadata,
  spec: AgentSpec,
})
export type AgentManifest = Schema.Schema.Type<typeof AgentManifest>

// ─── Skill ───────────────────────────────────────────────────────────

const SkillInput = Schema.Struct({
  key: Schema.String,
  type: Schema.String,
  required: Schema.optional(Schema.Boolean),
})

const SkillOutputs = Schema.Struct({
  schema: Schema.optional(Schema.String),
})

const SkillLoadStrategy = Schema.Literals(["eager", "lazy"])

export const SkillSpec = Schema.Struct({
  applicableAgents: Schema.optional(Schema.Array(Name)),
  applicableCapabilities: Schema.optional(Schema.Array(Name)),
  requiredTools: Schema.Array(Schema.String),
  requiredSkills: Schema.optional(Schema.Array(Name)),
  resources: Schema.optional(Schema.Array(Schema.String)),
  inputs: Schema.optional(Schema.Array(SkillInput)),
  outputs: Schema.optional(SkillOutputs),
  loadStrategy: Schema.optional(SkillLoadStrategy),
  triggerKeywords: Schema.optional(Schema.Array(Schema.String)),
})
export type SkillSpec = Schema.Schema.Type<typeof SkillSpec>

export const SkillManifest = Schema.Struct({
  apiVersion: ApiVersion,
  kind: Schema.Literals(["Skill"]),
  metadata: Metadata,
  spec: SkillSpec,
  /**
   * SKILL.md body (Markdown). Optional because some skills carry only
   * structured spec data and inject prompt content at runtime.
   */
  body: Schema.optional(Schema.String),
})
export type SkillManifest = Schema.Schema.Type<typeof SkillManifest>

// ─── Capability ──────────────────────────────────────────────────────

const CapabilityCategory = Schema.Literals([
  "hr-screening",
  "hr-jd",
  "hr-interview",
  "hr-report",
  "hr-internal",
  "productivity",
  "entertainment",
  "system",
  "meta",
  "custom",
])

const CapabilityInputField = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  type: Schema.String,
  default: Schema.optional(Schema.Unknown),
  options: Schema.optional(Schema.Array(Schema.String)),
})

const CapabilityVisibility = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  requiredFeatureFlags: Schema.optional(Schema.Array(Schema.String)),
  requiredRoles: Schema.optional(Schema.Array(Schema.String)),
})

export const CapabilitySpec = Schema.Struct({
  agentName: Name,
  category: CapabilityCategory,
  order: Schema.optional(Schema.Number),
  badge: Schema.optional(Schema.String),
  color: Schema.optional(Schema.String),
  hidden: Schema.optional(Schema.Boolean),
  defaultActive: Schema.optional(Schema.Boolean),
  /**
   * Whether this capability requires a workspace for file I/O.
   *
   * When `true`, a workspace is automatically created when a new session
   * is started with this capability, and the workspace is bound to the session.
   * When `false` (default), no workspace is created — the capability is
   * purely conversational.
   *
   * Spec reference: openspec/changes/use_def/session-workspace-binding/design.md §D2
   */
  needsWorkspace: Schema.optional(Schema.Boolean),
  contextKeys: Schema.Array(Schema.String),
  entryPrompt: Schema.optional(Schema.String),
  quickReplies: Schema.optional(Schema.Array(Schema.String)),
  inputSchema: Schema.optional(Schema.Array(CapabilityInputField)),
  visibility: Schema.optional(CapabilityVisibility),
})
export type CapabilitySpec = Schema.Schema.Type<typeof CapabilitySpec>

export const CapabilityManifest = Schema.Struct({
  apiVersion: ApiVersion,
  kind: Schema.Literals(["Capability"]),
  metadata: Metadata,
  spec: CapabilitySpec,
})
export type CapabilityManifest = Schema.Schema.Type<typeof CapabilityManifest>

// ─── Discriminated union ─────────────────────────────────────────────

/**
 * AnyManifest — any kind of HSAS manifest.
 *
 * Use the `kind` field to narrow:
 *   if (m.kind === "Agent") { /* m is AgentManifest *\/ }
 */
export type AnyManifest = AgentManifest | SkillManifest | CapabilityManifest

/**
 * Convenience constants for tests / external code that want to reference
 * the literal values without importing Schema typings.
 */
export const KIND = {
  agent: "Agent",
  skill: "Skill",
  capability: "Capability",
} as const

export const API_VERSION_V1 = "hsas.seven-hrops/v1" as const
