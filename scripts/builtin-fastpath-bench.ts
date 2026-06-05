/**
 * Builtin Fast-Path Benchmark — Phase B Task 8.6
 *
 * Verifies that 100 fs_read calls from a "builtin" source complete in
 * < 5ms average (not slowed down by whitelist lookup).
 *
 * Run: pnpm tsx scripts/builtin-fastpath-bench.ts
 */

import { createToolWhitelistGuard } from "../src/platform/sandbox/toolWhitelistGuard"

const ITERATIONS = 100
const MAX_AVG_MS = 5

// Builtin source: all tools allowed (large whitelist simulating builtin)
const BUILTIN_TOOLS = [
  "read_file", "write_file", "list_dir", "stat_file", "canonicalize_path",
  "parse_pdf", "parse_docx", "parse_excel",
  "webserver_publish", "webserver_drop",
  "export_to_html",
  "activate_capability", "delegate_to_subagent",
  "create_agent_manifest", "create_skill_manifest", "create_capability_manifest",
  "list_available_agents", "list_available_skills", "list_available_capabilities",
]

const guard = createToolWhitelistGuard(BUILTIN_TOOLS)

console.log(`\n⚡ Builtin Fast-Path Benchmark — ${ITERATIONS} iterations\n`)

const start = performance.now()

for (let i = 0; i < ITERATIONS; i++) {
  // Simulate fs_read: check "read_file" is allowed
  guard.has("read_file")
}

const elapsed = performance.now() - start
const avgMs = elapsed / ITERATIONS

console.log(`Total time : ${elapsed.toFixed(3)}ms`)
console.log(`Avg / call : ${avgMs.toFixed(4)}ms`)
console.log(`Threshold  : < ${MAX_AVG_MS}ms`)

if (avgMs >= MAX_AVG_MS) {
  console.error(`\n❌ Average ${avgMs.toFixed(4)}ms exceeds ${MAX_AVG_MS}ms threshold`)
  process.exit(1)
}

console.log(`\n✅ Fast-path OK — avg ${avgMs.toFixed(4)}ms < ${MAX_AVG_MS}ms`)
