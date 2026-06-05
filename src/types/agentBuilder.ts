/**
 * Agent Builder Types
 *
 * Shared types for the natural language → agent manifest builder.
 * Source of truth: src/types/agentBuilder.ts
 */

export interface BuilderRequest {
  description: string
  baseCapabilityId?: string
}

export interface BuilderPreview {
  /** YAML string of the generated agent manifest. */
  agentManifest: string
  /** YAML string of the generated skill manifest. */
  skillManifest: string
  /** YAML string of the generated capability manifest. */
  capabilityManifest: string
}
