/**
 * SkillLoader — turns an HSAS SkillManifest into a runtime `Skill.Info`
 * and registers it into `Skill.Service`.
 *
 * Spec reference:
 *   - openspec/changes/platform-foundation-mvb/specs/skill-loader/spec.md
 *
 * Pipeline mirrors AgentLoader:
 *   1. validate     — `manifestValidator.validate(raw, ctx)`
 *   2. authorise    — for each tool in `spec.requiredTools`, run
 *                     `toolRegistry.assertAllowed(tool, source)`
 *   3. transform    — `manifestToSkillInfo(manifest)`
 *   4. register     — `skillService.register(info)` (or registerMany)
 */

import { Effect } from "effect"
import { parse as parseYaml } from "yaml"

import { Skill, type Info as SkillInfo } from "../../agent-runtime/skill/index"
import {
  validate,
  ValidationError,
  type ValidationContext,
} from "../hsas/validator"
import { toolRegistry, type ToolSource } from "../registry/toolRegistry"
import { type AnyManifest, type SkillManifest } from "../hsas/schema"

// ─── Pure transform ──────────────────────────────────────────────────

/**
 * Build a runtime `Skill.Info` from a validated `SkillManifest`.
 *
 *   - `metadata.name` → `info.name`
 *   - `metadata.description` → `info.description`
 *   - `body` (markdown) → `info.content` (defaults to "" when missing)
 */
export const manifestToSkillInfo = (m: SkillManifest): SkillInfo => ({
  name: m.metadata.name,
  description: m.metadata.description,
  content: m.body ?? "",
})

// ─── SkillLoader ─────────────────────────────────────────────────────

export interface LoadOptions {
  readonly validationContext?: ValidationContext
}

const defaultCtx = (): ValidationContext => ({
  toolExists: (t: string) => toolRegistry.has(t),
  toolAllowedForSource: (t: string, s: ToolSource) => toolRegistry.allowed(t, s),
})

export const load = (
  raw: unknown,
  opts: LoadOptions = {},
): Effect.Effect<SkillInfo, ValidationError | Error, Skill.Service> =>
  Effect.gen(function* () {
    const skillService = yield* Skill.Service

    const ctx = opts.validationContext ?? defaultCtx()
    const manifest = (yield* validate(raw, ctx)) as AnyManifest
    if (manifest.kind !== "Skill") {
      throw new ValidationError(
        "INVALID_KIND",
        `skillLoader received a manifest with kind="${manifest.kind}"`,
      )
    }
    const sm = manifest as SkillManifest

    // authorise tools
    for (const tool of sm.spec.requiredTools) {
      toolRegistry.assertAllowed(tool, sm.metadata.source)
    }

    const info = manifestToSkillInfo(sm)
    yield* skillService.register(info)
    return info
  })

export const loadMany = (
  raws: ReadonlyArray<unknown>,
  opts: LoadOptions = {},
): Effect.Effect<ReadonlyArray<SkillInfo>, ValidationError | Error, Skill.Service> =>
  Effect.gen(function* () {
    const out: SkillInfo[] = []
    for (const raw of raws) {
      out.push(yield* load(raw, opts))
    }
    return out
  })

export const unload = (
  name: string,
): Effect.Effect<void, Error, Skill.Service> =>
  Effect.gen(function* () {
    const skillService = yield* Skill.Service
    yield* skillService.unregister(name)
  })

/**
 * Convenience wrapper: parse YAML text then call `load`. When `sidecar`
 * (the matching `*.SKILL.md` body) is supplied it **overrides**
 * `yaml.body` — this matches the bootstrap convention where the markdown
 * file is authoritative and the yaml `body` field is at most a fallback
 * stub.
 *
 * Sidecar precedence: explicit `sidecar` arg > `yaml.body` > empty string.
 *
 * Throws `ValidationError("YAML_PARSE_FAILED", ...)` on malformed YAML.
 */
export const loadFromYaml = (
  yamlText: string,
  sidecar?: string,
  opts: LoadOptions = {},
): Effect.Effect<SkillInfo, ValidationError | Error, Skill.Service> =>
  Effect.gen(function* () {
    let raw: unknown
    try {
      raw = parseYaml(yamlText)
    } catch (e) {
      throw new ValidationError(
        "YAML_PARSE_FAILED",
        `skillLoader.loadFromYaml: ${(e as Error).message}`,
      )
    }
    // Sidecar wins: shallow-merge `body` onto the parsed object before
    // validation so the resulting SkillInfo carries the markdown text.
    if (sidecar !== undefined && raw && typeof raw === "object") {
      ;(raw as { body?: string }).body = sidecar
    }
    return yield* load(raw, opts)
  })

export const skillLoader = { load, loadMany, loadFromYaml, unload, manifestToSkillInfo } as const
export type SkillLoader = typeof skillLoader
