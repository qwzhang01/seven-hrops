/**
 * builtinSeed — discovers built-in HSAS manifests at build time via
 * Vite's `import.meta.glob`, validates filename↔manifest.metadata.name
 * agreement, and rejects multi-document YAML files.
 *
 * Implementation notes (6.2 / 6.3):
 *
 *   - We import each YAML as a *raw string* (`{ as: "raw", eager: true }`)
 *     rather than as a parsed object. The bootstrap pipeline then feeds
 *     the strings into `loadFromYaml` / `installFromYaml` so that:
 *       1. The 5.x YAML_PARSE_FAILED contract is exercised in production
 *          (not just in unit tests).
 *       2. Skill manifests pick up their `*.SKILL.md` sidecars via the
 *          5.7 sidecar-precedence rule.
 *
 *   - Filename mismatch → throws `ValidationError("MANIFEST_FILENAME_MISMATCH")`.
 *     The basename (without `.yaml`) MUST equal `metadata.name`. This is
 *     a defence-in-depth check: vite-glob is alphabetic but registries
 *     are name-keyed, so a typo'd filename can otherwise install under
 *     the wrong key.
 *
 *   - Multi-document YAML (`---\n…---\n…`) → throws
 *     `ValidationError("MANIFEST_MULTIDOC_NOT_ALLOWED")`. Splitting one
 *     persona across two YAML docs would silently install only the first.
 *     We reject early with a clear error.
 *
 *   - Skills additionally pick up an adjacent `*.SKILL.md` sidecar (same
 *     basename, different extension). When present, its body becomes the
 *     skill content (per 5.7 precedence). When absent, the skill falls
 *     back to whatever `body:` is declared inline in the YAML.
 */

import { parse as parseYaml } from "yaml"

import { ValidationError } from "./hsas/validator"

// ─── Types ────────────────────────────────────────────────────────────

export interface BuiltinSkillSeed {
  readonly filename: string
  readonly yaml: string
  /** Sidecar markdown body, if a `*.SKILL.md` file with the matching basename exists. */
  readonly sidecar?: string
}

export interface BuiltinAgentSeed {
  readonly filename: string
  readonly yaml: string
}

export interface BuiltinCapabilitySeed {
  readonly filename: string
  readonly yaml: string
}

// ─── Validation helpers ───────────────────────────────────────────────

const basenameOf = (path: string): string => {
  const slash = path.lastIndexOf("/")
  const tail = slash >= 0 ? path.slice(slash + 1) : path
  return tail.replace(/\.ya?ml$/i, "")
}

const assertSingleDocument = (yamlText: string, filename: string): void => {
  // YAML 1.2 spec: documents are separated by `---` on its own line. A
  // *leading* `---\n` is the directives-end marker and is allowed for a
  // single document. Detect "more than one document" by counting
  // separators that appear *after* any leading content.
  const lines = yamlText.split(/\r?\n/)
  let docCount = 0
  let sawNonSeparatorContent = false
  for (const line of lines) {
    if (/^---\s*$/.test(line)) {
      // A `---` after we have already seen content starts a new doc.
      if (sawNonSeparatorContent) {
        docCount++
      }
    } else if (line.trim() !== "" && !/^#/.test(line)) {
      sawNonSeparatorContent = true
    }
  }
  if (docCount >= 1) {
    throw new ValidationError(
      "MANIFEST_MULTIDOC_NOT_ALLOWED",
      `Manifest "${filename}" contains multiple YAML documents. Each manifest file must declare exactly one document.`,
      { filename, extraDocCount: docCount },
    )
  }
}

const assertFilenameMatches = (
  yamlText: string,
  filename: string,
): void => {
  let parsed: { metadata?: { name?: unknown } } | null | undefined
  try {
    parsed = parseYaml(yamlText) as
      | { metadata?: { name?: unknown } }
      | null
      | undefined
  } catch {
    // YAML parse errors will be surfaced later by `loadFromYaml`. We only
    // validate the filename-name contract here when we can read the name.
    return
  }
  const declared = parsed?.metadata?.name
  if (typeof declared !== "string" || declared.length === 0) {
    return // schema validator will catch missing `metadata.name`
  }
  const basename = basenameOf(filename)
  if (declared !== basename) {
    throw new ValidationError(
      "MANIFEST_FILENAME_MISMATCH",
      `Manifest "${filename}" declares metadata.name="${declared}" but its filename basename is "${basename}". They MUST match so registry keys agree with the filesystem.`,
      { filename, basename, declared },
    )
  }
}

// ─── Glob discovery ───────────────────────────────────────────────────

// `as: "raw"` returns the file's text content. `eager: true` resolves the
// glob synchronously at build time so bootstrap is deterministic and we
// never await on imports.
//
// IMPORTANT: the glob patterns are static string literals — Vite cannot
// resolve dynamic globs.
const SKILL_YAMLS = import.meta.glob<string>(
  "./manifests/skills/*.yaml",
  { query: "?raw", import: "default", eager: true },
)
const SKILL_SIDECARS = import.meta.glob<string>(
  "./manifests/skills/*.SKILL.md",
  { query: "?raw", import: "default", eager: true },
)
const AGENT_YAMLS = import.meta.glob<string>(
  "./manifests/agents/*.yaml",
  { query: "?raw", import: "default", eager: true },
)
const CAPABILITY_YAMLS = import.meta.glob<string>(
  "./manifests/capabilities/*.yaml",
  { query: "?raw", import: "default", eager: true },
)

// ─── Build seed lists ─────────────────────────────────────────────────

const buildSkillSeeds = (): ReadonlyArray<BuiltinSkillSeed> => {
  const seeds: BuiltinSkillSeed[] = []
  // Index sidecars by their basename (without `.SKILL.md`) so we can
  // pair them with yaml files of the same logical name.
  const sidecarByBase = new Map<string, string>()
  for (const [path, body] of Object.entries(SKILL_SIDECARS)) {
    const slash = path.lastIndexOf("/")
    const tail = slash >= 0 ? path.slice(slash + 1) : path
    const base = tail.replace(/\.SKILL\.md$/i, "")
    sidecarByBase.set(base, body)
  }
  for (const [path, yaml] of Object.entries(SKILL_YAMLS)) {
    assertSingleDocument(yaml, path)
    assertFilenameMatches(yaml, path)
    const base = basenameOf(path)
    seeds.push({
      filename: path,
      yaml,
      sidecar: sidecarByBase.get(base),
    })
  }
  // Sort by basename so bootstrap order is deterministic across platforms.
  return seeds.sort((a, b) => basenameOf(a.filename).localeCompare(basenameOf(b.filename)))
}

const buildAgentSeeds = (): ReadonlyArray<BuiltinAgentSeed> => {
  const seeds: BuiltinAgentSeed[] = []
  for (const [path, yaml] of Object.entries(AGENT_YAMLS)) {
    assertSingleDocument(yaml, path)
    assertFilenameMatches(yaml, path)
    seeds.push({ filename: path, yaml })
  }
  return seeds.sort((a, b) => basenameOf(a.filename).localeCompare(basenameOf(b.filename)))
}

const buildCapabilitySeeds = (): ReadonlyArray<BuiltinCapabilitySeed> => {
  const seeds: BuiltinCapabilitySeed[] = []
  for (const [path, yaml] of Object.entries(CAPABILITY_YAMLS)) {
    assertSingleDocument(yaml, path)
    assertFilenameMatches(yaml, path)
    seeds.push({ filename: path, yaml })
  }
  return seeds.sort((a, b) => basenameOf(a.filename).localeCompare(basenameOf(b.filename)))
}

export const BUILTIN_SKILL_SEEDS: ReadonlyArray<BuiltinSkillSeed> = buildSkillSeeds()
export const BUILTIN_AGENT_SEEDS: ReadonlyArray<BuiltinAgentSeed> = buildAgentSeeds()
export const BUILTIN_CAPABILITY_SEEDS: ReadonlyArray<BuiltinCapabilitySeed> =
  buildCapabilitySeeds()

// ─── Test-only helpers ────────────────────────────────────────────────

/**
 * Test entry-point for `assertSingleDocument` and `assertFilenameMatches`.
 * Keeps the validation logic exported so unit tests can target it without
 * needing to round-trip through Vite's glob.
 */
export const __seedValidators = {
  basenameOf,
  assertSingleDocument,
  assertFilenameMatches,
} as const
