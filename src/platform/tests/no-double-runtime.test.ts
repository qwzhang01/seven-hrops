/**
 * Reverse-test: enforce the "no double runtime" architectural invariant
 * established by `consolidate-platform-runtime`.
 *
 * Rule: nothing under `src/` should reference the legacy global
 * `window.__agentRuntime`. The agent runtime now lives behind
 * `window.__platform.runtime`; bootstrap is the sole owner.
 *
 * Why a test (vs. a lint rule)? It's cheaper to maintain — and it gives
 * us a clear failure message pointing at the offending file path the
 * moment someone re-introduces the legacy global.
 */

import { describe, it, expect } from "vitest"
import { promises as fs } from "node:fs"
import path from "node:path"

const SRC_DIR = path.resolve(__dirname, "../../")
const TEST_FILE_PATH = path.resolve(__filename)

// File extensions we consider "code" for the purposes of this scan.
// (No .json / .md — those legitimately mention historical names.)
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs"])

/**
 * Recursively walk the tree, returning all code files except node_modules
 * / dist / __tests__ artefacts and this test file itself.
 */
async function collectCodeFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue
      // Test directories may legitimately reference the legacy name when
      // *asserting that it's gone*; skipping them keeps the invariant
      // focused on production code.
      if (entry.name === "__tests__" || entry.name === "test") continue
      out.push(...(await collectCodeFiles(full)))
    } else if (entry.isFile()) {
      if (full === TEST_FILE_PATH) continue
      // Also skip *.test.ts / *.test.tsx that might live alongside source.
      if (/\.test\.(ts|tsx|js|jsx)$/.test(entry.name)) continue
      const ext = path.extname(entry.name)
      if (CODE_EXTENSIONS.has(ext)) out.push(full)
    }
  }
  return out
}

describe("no-double-runtime invariant", () => {
  it("does not reference the legacy `__agentRuntime` global anywhere in src/", async () => {
    const files = await collectCodeFiles(SRC_DIR)
    const offenders: string[] = []
    for (const file of files) {
      const content = await fs.readFile(file, "utf8")
      if (content.includes("__agentRuntime")) {
        offenders.push(path.relative(SRC_DIR, file))
      }
    }
    expect(offenders, `found __agentRuntime references in: ${offenders.join(", ")}`).toEqual(
      [],
    )
  })
})
