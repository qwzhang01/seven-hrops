// THIS FILE IS AUTO-GENERATED — DO NOT EDIT.
// Run `pnpm run codegen` to regenerate from src-tauri/src/manifest/*.rs
//
// Pipeline: Rust struct (truth) → schemars → JSON Schema → json-schema-to-typescript → this file.

// ───────────────────────────────────────────────────────────
// AgentManifest  (source: platform/schemas/agent.schema.json)
// ───────────────────────────────────────────────────────────
export type AgentKindTag = "Agent";
/**
 * Source of a manifest — controls sandbox fast-path and tool whitelist.
 */
export type Source = "builtin" | "user" | "marketplace";
/**
 * Discriminator for agent execution mode.
 */
export type AgentMode = "primary" | "subagent";
export type PermissionAction = "allow" | "deny" | "ask";

/**
 * Top-level Agent manifest object.
 *
 * Note: `kind` is hard-coded to `"Agent"` via `tag = "kind"` on `AnyManifest`, but here in the standalone struct we still serialize it explicitly so a stand-alone `agent.yaml` round-trips faithfully.
 */
export interface AgentManifest {
  apiVersion: string;
  kind: AgentKindTag;
  metadata: Metadata;
  spec: AgentSpec;
}
/**
 * Shared metadata across all three manifest kinds.
 */
export interface Metadata {
  author?: string | null;
  authorEmail?: string | null;
  createdAt: string;
  deprecated?: boolean | null;
  deprecatedReason?: string | null;
  description: string;
  displayName: string;
  homepage?: string | null;
  icon?: string | null;
  name: string;
  signature?: string | null;
  source: Source;
  tags?: string[] | null;
  updatedAt?: string | null;
  version: string;
}
export interface AgentSpec {
  basePrompt: string;
  capabilityBinding?: AgentCapabilityBinding | null;
  contextKeys?: string[] | null;
  contextTemplate?: string | null;
  filesystem?: AgentFilesystem | null;
  inheritFrom?: AgentInheritFrom | null;
  mode: AgentMode;
  model?: AgentModelConfig | null;
  network?: AgentNetwork | null;
  permission?: PermissionRule[] | null;
  resources?: AgentResources | null;
  skills?: string[] | null;
  tools: AgentTools;
}
export interface AgentCapabilityBinding {
  autoCreate?: boolean | null;
  capabilityId: string;
}
export interface AgentFilesystem {
  readPaths?: string[] | null;
  writePaths?: string[] | null;
}
export interface AgentInheritFrom {
  name: string;
  overrides: string[];
}
export interface AgentModelConfig {
  maxTokens?: number | null;
  modelID: string;
  provider: string;
  temperature?: number | null;
  topP?: number | null;
}
export interface AgentNetwork {
  allowedHosts: string[];
}
/**
 * Permission rule — shared by Agent and certain Skills.
 */
export interface PermissionRule {
  action: PermissionAction;
  pattern: string;
  permission: string;
}
export interface AgentResources {
  maxConcurrentSessions?: number | null;
  maxTokensPerSession?: number | null;
  maxToolCallsPerMinute?: number | null;
}
export interface AgentTools {
  allowed: string[];
  autoApprove?: string[] | null;
  deny?: string[] | null;
}

// ───────────────────────────────────────────────────────────
// SkillManifest  (source: platform/schemas/skill.schema.json)
// ───────────────────────────────────────────────────────────
export type SkillKindTag = "Skill";
export type SkillLoadStrategy = "eager" | "lazy";

export interface SkillManifest {
  apiVersion: string;
  /**
   * SKILL.md body (Markdown). Optional — sidecar `.SKILL.md` file overrides.
   */
  body?: string | null;
  kind: SkillKindTag;
  metadata: Metadata;
  spec: SkillSpec;
}
export interface SkillSpec {
  applicableAgents?: string[] | null;
  applicableCapabilities?: string[] | null;
  inputs?: SkillInput[] | null;
  loadStrategy?: SkillLoadStrategy | null;
  outputs?: SkillOutputs | null;
  requiredSkills?: string[] | null;
  requiredTools: string[];
  resources?: string[] | null;
  triggerKeywords?: string[] | null;
}
export interface SkillInput {
  key: string;
  required?: boolean | null;
  type: string;
}
export interface SkillOutputs {
  schema?: string | null;
}

// ───────────────────────────────────────────────────────────
// CapabilityManifest  (source: platform/schemas/capability.schema.json)
// ───────────────────────────────────────────────────────────
export type CapabilityKindTag = "Capability";
/**
 * HR-domain category enumeration.
 *
 * Keep parity with `manifestSchema.ts`'s `CapabilityCategory` literal union.
 */
export type CapabilityCategory =
  | "hr-screening"
  | "hr-jd"
  | "hr-interview"
  | "hr-report"
  | "hr-internal"
  | "productivity"
  | "entertainment"
  | "system"
  | "custom";

export interface CapabilityManifest {
  apiVersion: string;
  kind: CapabilityKindTag;
  metadata: Metadata;
  spec: CapabilitySpec;
}
export interface CapabilitySpec {
  agentName: string;
  badge?: string | null;
  category: CapabilityCategory;
  color?: string | null;
  contextKeys: string[];
  entryPrompt?: string | null;
  inputSchema?: CapabilityInputField[] | null;
  order?: number | null;
  quickReplies?: string[] | null;
  visibility?: CapabilityVisibility | null;
}
export interface CapabilityInputField {
  /**
   * `default` is `unknown` in TS — we keep it as serde_json::Value for parity.
   */
  default?: {
    [k: string]: unknown | undefined;
  };
  key: string;
  label: string;
  options?: string[] | null;
  type: string;
}
export interface CapabilityVisibility {
  enabled?: boolean | null;
  requiredFeatureFlags?: string[] | null;
  requiredRoles?: string[] | null;
}
