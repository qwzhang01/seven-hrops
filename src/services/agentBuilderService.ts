/**
 * Agent Builder Service — natural language → agent manifest generation.
 *
 * Phase C: Skeleton only. Phase H will implement the real LLM-based builder.
 */

import type { BuilderRequest, BuilderPreview } from "@/types/agentBuilder"

export type { BuilderRequest, BuilderPreview }

// ─── previewBuild ────────────────────────────────────────────────────

/**
 * Generate a preview of agent/skill/capability manifests from a description.
 * TODO Phase H: call agent-builder Agent via platform runtime.
 */
export async function previewBuild(req: BuilderRequest): Promise<BuilderPreview> {
  return {
    agentManifest: `# TODO: generated from "${req.description}"`,
    skillManifest: "",
    capabilityManifest: "",
  }
}

// ─── installBuild ────────────────────────────────────────────────────

/**
 * Install a previewed build into the registry.
 * TODO Phase H: write manifests to disk, call capabilityRegistry.installFromYaml.
 */
export async function installBuild(_preview: BuilderPreview): Promise<string> {
  throw new Error("AgentBuilder not yet implemented (Phase H)")
}
