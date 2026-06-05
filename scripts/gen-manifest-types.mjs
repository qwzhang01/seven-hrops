#!/usr/bin/env node
// THIS SCRIPT GENERATES src/types/manifest.generated.ts
// Source of truth: src-tauri/src/manifest/*.rs (via schemars -> JSON Schema).
// Pipeline: cargo run --bin gen_manifest_schema  →  platform/schemas/*.schema.json
//                                                ↓
//                                  this script (json-schema-to-typescript)
//                                                ↓
//                                src/types/manifest.generated.ts
//
// Why json-schema-to-typescript instead of ts-rs:
//   ts-rs 10.x cannot parse combined serde attributes
//   (e.g. #[serde(rename = "...", skip_serializing_if = "...", default)])
//   and its export_all() does not aggregate types into a single file.
//   See openspec/changes/phase-b-platform-foundation/design.md Decision 3.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_DIR = path.join(REPO_ROOT, "platform", "schemas");
const OUT_FILE = path.join(REPO_ROOT, "src", "types", "manifest.generated.ts");

const SCHEMAS = [
  { file: "agent.schema.json", title: "AgentManifest" },
  { file: "skill.schema.json", title: "SkillManifest" },
  { file: "capability.schema.json", title: "CapabilityManifest" },
];

const HEADER = `// THIS FILE IS AUTO-GENERATED — DO NOT EDIT.
// Run \`pnpm run codegen\` to regenerate from src-tauri/src/manifest/*.rs
//
// Pipeline: Rust struct (truth) → schemars → JSON Schema → json-schema-to-typescript → this file.
`;

const COMPILE_OPTS = {
  bannerComment: "",
  additionalProperties: false,
  declareExternallyReferenced: true,
  unreachableDefinitions: false,
  strictIndexSignatures: true,
  style: { singleQuote: false, semi: true },
};

async function main() {
  if (!existsSync(SCHEMA_DIR)) {
    throw new Error(
      `Schema directory not found: ${SCHEMA_DIR}\n` +
        `Run \`cargo run --bin gen_manifest_schema\` first.`,
    );
  }

  const blocks = [];
  for (const { file, title } of SCHEMAS) {
    const schemaPath = path.join(SCHEMA_DIR, file);
    if (!existsSync(schemaPath)) {
      throw new Error(`Missing schema: ${schemaPath}`);
    }
    const raw = await readFile(schemaPath, "utf8");
    const schema = JSON.parse(raw);
    // schemars sets `title` from the Rust type name when emitting the root.
    // Force the title so the top-level export name is predictable.
    schema.title = title;

    const ts = await compile(schema, title, COMPILE_OPTS);
    blocks.push(
      `// ───────────────────────────────────────────────────────────\n` +
        `// ${title}  (source: platform/schemas/${file})\n` +
        `// ───────────────────────────────────────────────────────────\n` +
        ts.trim() +
        "\n",
    );
  }

  const body = HEADER + "\n" + dedupeTopLevelDecls(blocks.join("\n"));
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, body, "utf8");
  console.log(`[gen-manifest-types] wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
}

/**
 * Remove duplicated top-level `export type` / `export interface` declarations.
 *
 * The 3 schemas (agent / skill / capability) each carry their own copy of
 * shared types like `Source` and `Metadata` because schemars serialises every
 * referenced type into every standalone schema. After concatenation we'd hit
 * `TS2300: Duplicate identifier`. This pass keeps the first declaration and
 * drops every later block whose declared name has already been emitted.
 *
 * The matcher is line-anchored and supports leading JSDoc (a `/** ... *\/`
 * block immediately preceding the `export` line); the deletion includes that
 * comment so we don't leave orphaned doc-blocks in the output.
 */
function dedupeTopLevelDecls(src) {
  const lines = src.split("\n");
  const out = [];
  const seen = new Set();
  let i = 0;
  while (i < lines.length) {
    // Detect optional leading JSDoc immediately above an export.
    let jsdocStart = -1;
    if (lines[i].trimStart().startsWith("/**")) {
      jsdocStart = i;
      let j = i;
      while (j < lines.length && !lines[j].includes("*/")) j++;
      const afterDoc = j + 1;
      const target = lines[afterDoc] ?? "";
      const m = target.match(/^export\s+(?:type|interface)\s+(\w+)\b/);
      if (m) {
        const name = m[1];
        const blockEnd = findBlockEnd(lines, afterDoc);
        if (seen.has(name)) {
          // skip jsdoc + declaration block + trailing blank line
          i = blockEnd + 1;
          if (i < lines.length && lines[i].trim() === "") i++;
          continue;
        }
        seen.add(name);
        for (let k = jsdocStart; k <= blockEnd; k++) out.push(lines[k]);
        i = blockEnd + 1;
        continue;
      }
    }
    const m = lines[i].match(/^export\s+(?:type|interface)\s+(\w+)\b/);
    if (m) {
      const name = m[1];
      const blockEnd = findBlockEnd(lines, i);
      if (seen.has(name)) {
        i = blockEnd + 1;
        if (i < lines.length && lines[i].trim() === "") i++;
        continue;
      }
      seen.add(name);
      for (let k = i; k <= blockEnd; k++) out.push(lines[k]);
      i = blockEnd + 1;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

/**
 * Find the end-of-declaration line index given the start line.
 *  - `export type X = ...;` ends on the first line whose trimmed content ends with `;`.
 *  - `export interface X { ... }` ends on the matching closing `}`.
 */
function findBlockEnd(lines, start) {
  const head = lines[start];
  if (/^export\s+type\b/.test(head)) {
    let j = start;
    while (j < lines.length && !lines[j].trimEnd().endsWith(";")) j++;
    return Math.min(j, lines.length - 1);
  }
  // interface or fallback: brace-balanced search
  let depth = 0;
  let started = false;
  for (let j = start; j < lines.length; j++) {
    const line = lines[j];
    for (const ch of line) {
      if (ch === "{") {
        depth++;
        started = true;
      } else if (ch === "}") {
        depth--;
        if (started && depth === 0) return j;
      }
    }
  }
  return lines.length - 1;
}

main().catch((err) => {
  console.error("[gen-manifest-types] FAILED:", err);
  process.exit(1);
});
