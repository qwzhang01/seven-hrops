import { Effect, Layer, Context, Schema } from "effect"
import type { Info as AgentInfo } from "../agent/agent"
import { Permission } from "../permission/index"

/**
 * Skill System — Manages skill definitions that guide Agent behavior.
 *
 * Adapted from OpenCode's skill/index.ts (319 lines) — simplified for HROps:
 * - Removed: File system discovery, Glob scanning, Config integration,
 *   Discovery service, External skill directories, Built-in skills
 * - Kept: Skill Info schema, get/all/available interface, Permission filtering
 * - Simplified: Direct registration instead of file-based discovery
 *
 * v2.0 platform foundation: built-in skills are no longer hardcoded here.
 * Skills are registered exclusively through `SkillLoader` (which reads
 * HSAS Manifests). The Service is a pure runtime registry.
 */

// ─── Types ───────────────────────────────────────────────────────────

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  content: Schema.String,
})
export type Info = Schema.Schema.Type<typeof Info>

// ─── Service ─────────────────────────────────────────────────────────

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<Info[]>
  readonly available: (agent?: AgentInfo) => Effect.Effect<Info[]>
  readonly register: (skill: Info) => Effect.Effect<void>
  readonly registerMany: (skills: ReadonlyArray<Info>) => Effect.Effect<void>
  readonly unregister: (name: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@agent-runtime/Skill") {}

// ─── Implementation ──────────────────────────────────────────────────

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // Mutable registry of skills — populated at runtime via `register`
    // (typically by the SkillLoader during platform bootstrap).
    const skills = new Map<string, Info>()

    const get = Effect.fn("Skill.get")(function* (name: string) {
      return skills.get(name)
    })

    const all = Effect.fn("Skill.all")(function* () {
      return Array.from(skills.values()).sort((a, b) => a.name.localeCompare(b.name))
    })

    const available = Effect.fn("Skill.available")(function* (agent?: AgentInfo) {
      const list = Array.from(skills.values()).sort((a, b) => a.name.localeCompare(b.name))
      if (!agent) return list
      return list.filter(
        (skill) => Permission.evaluate("skill", skill.name, [...agent.permission]).action !== "deny",
      )
    })

    const register = Effect.fn("Skill.register")(function* (skill: Info) {
      if (skills.has(skill.name)) {
        throw new Error(`Skill "${skill.name}" already exists`)
      }
      skills.set(skill.name, skill)
    })

    const registerMany = Effect.fn("Skill.registerMany")(function* (newSkills: ReadonlyArray<Info>) {
      for (const skill of newSkills) {
        skills.set(skill.name, skill)
      }
    })

    const unregister = Effect.fn("Skill.unregister")(function* (name: string) {
      if (!skills.has(name)) {
        throw new Error(`Skill "${name}" not found`)
      }
      skills.delete(name)
    })

    return Service.of({ get, all, available, register, registerMany, unregister })
  }),
)

export const defaultLayer = layer

/**
 * Format skill list for inclusion in Agent prompts.
 */
export function fmt(list: Info[]): string {
  if (list.length === 0) return "No skills are currently available."
  return [
    "## Available Skills",
    ...list
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((skill) => `- **${skill.name}**: ${skill.description ?? "No description"}`),
  ].join("\n")
}

export const Skill = { Info, Service, defaultLayer, layer, fmt }

// Type-only namespace so consumers can write `Skill.Service` / `Skill.Info`
// in type positions. See `agent.ts` for rationale.
export namespace Skill {
  export type Service = InstanceType<typeof Service>
  export type Info = Schema.Schema.Type<typeof Info>
}
