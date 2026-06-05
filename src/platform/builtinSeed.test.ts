/**
 * Tests for builtinSeed.ts (Phase B 6.x contract).
 *
 * Coverage:
 *   1. The builtin seeds (skill / agent / capability) are discovered
 *      via `import.meta.glob`.
 *   2. Skill seeds carry their `*.SKILL.md` sidecar text (5.7 precedence
 *      will use it to override yaml.body).
 *   3. The 6.3 file-level guards reject filename↔metadata.name mismatches
 *      and multi-document YAML files with the right error codes.
 */

import { describe, it, expect } from "vitest"

import {
  BUILTIN_AGENT_SEEDS,
  BUILTIN_CAPABILITY_SEEDS,
  BUILTIN_SKILL_SEEDS,
  __seedValidators,
} from "./builtinSeed"
import { ValidationError } from "./hsas/validator"

describe("BUILTIN_*_SEEDS — discovery via import.meta.glob", () => {
  it("discovers builtin skills, agents and capabilities", () => {
    // Each seed array should be discoverable via import.meta.glob.
    // The exact filenames depend on what is placed under manifests/.
    expect(BUILTIN_SKILL_SEEDS).toBeInstanceOf(Array)
    expect(BUILTIN_AGENT_SEEDS).toBeInstanceOf(Array)
    expect(BUILTIN_CAPABILITY_SEEDS).toBeInstanceOf(Array)
  })

  it("attaches the SKILL.md sidecar to skill seeds that have one", () => {
    for (const seed of BUILTIN_SKILL_SEEDS) {
      if (seed.sidecar) {
        expect(seed.sidecar.length).toBeGreaterThan(0)
      }
    }
  })

  it("yaml strings parse to the expected metadata.name", () => {
    for (const seed of BUILTIN_SKILL_SEEDS) {
      expect(seed.yaml).toContain(`name: ${seed.filename.match(/([^/]+)\.yaml$/)?.[1] ?? ""}`)
    }
    for (const seed of BUILTIN_AGENT_SEEDS) {
      expect(seed.yaml).toContain(`name: ${seed.filename.match(/([^/]+)\.yaml$/)?.[1] ?? ""}`)
    }
    for (const seed of BUILTIN_CAPABILITY_SEEDS) {
      expect(seed.yaml).toContain(`name: ${seed.filename.match(/([^/]+)\.yaml$/)?.[1] ?? ""}`)
    }
  })
})

// ─── 6.3 file-level guards ────────────────────────────────────────────

describe("__seedValidators.assertFilenameMatches", () => {
  const { assertFilenameMatches } = __seedValidators

  it("accepts when basename equals metadata.name", () => {
    const yaml = `apiVersion: hsas.seven-hrops/v1
kind: Skill
metadata:
  name: my-skill
spec: {}
`
    expect(() =>
      assertFilenameMatches(yaml, "/manifests/skills/my-skill.yaml"),
    ).not.toThrow()
  })

  it("throws MANIFEST_FILENAME_MISMATCH when they disagree", () => {
    const yaml = `apiVersion: hsas.seven-hrops/v1
kind: Skill
metadata:
  name: real-name
spec: {}
`
    try {
      assertFilenameMatches(yaml, "/manifests/skills/wrong-name.yaml")
      throw new Error("expected throw")
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError)
      expect((e as ValidationError).code).toBe("MANIFEST_FILENAME_MISMATCH")
    }
  })

  it("is silent when metadata.name is absent (defers to schema validator)", () => {
    expect(() =>
      assertFilenameMatches("not: a: manifest", "/x.yaml"),
    ).not.toThrow()
  })
})

describe("__seedValidators.assertSingleDocument", () => {
  const { assertSingleDocument } = __seedValidators

  it("accepts a single document with a leading directives-end marker", () => {
    const yaml = `---
apiVersion: hsas.seven-hrops/v1
kind: Skill
metadata:
  name: ok
`
    expect(() => assertSingleDocument(yaml, "/x.yaml")).not.toThrow()
  })

  it("accepts a single document without any --- marker", () => {
    const yaml = `apiVersion: hsas.seven-hrops/v1
kind: Skill
metadata:
  name: ok
`
    expect(() => assertSingleDocument(yaml, "/x.yaml")).not.toThrow()
  })

  it("throws MANIFEST_MULTIDOC_NOT_ALLOWED when two documents are concatenated", () => {
    const yaml = `apiVersion: hsas.seven-hrops/v1
kind: Skill
metadata:
  name: first
---
apiVersion: hsas.seven-hrops/v1
kind: Skill
metadata:
  name: second
`
    try {
      assertSingleDocument(yaml, "/x.yaml")
      throw new Error("expected throw")
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError)
      expect((e as ValidationError).code).toBe("MANIFEST_MULTIDOC_NOT_ALLOWED")
    }
  })
})
