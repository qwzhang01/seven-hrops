/**
 * Sandbox Stress Test — Phase B Task 8.5
 *
 * Simulates 100 random fs/net calls from a "user" source manifest and
 * asserts that 100% are denied by the JS-side sandbox guards.
 *
 * Run: pnpm tsx scripts/sandbox-stress.ts
 */

import { createToolWhitelistGuard } from "../src/platform/sandbox/toolWhitelistGuard"
import { createNetworkGuard } from "../src/platform/sandbox/networkGuard"

// ─── Config ──────────────────────────────────────────────────────────

const ITERATIONS = 100

// Allowed tools for a "builtin" agent (the whitelist)
const ALLOWED_TOOLS = ["read_file", "list_dir", "stat_file"]

// Disallowed tools that a "user" source manifest might try to call
const DISALLOWED_TOOLS = [
  "write_file",
  "canonicalize_path",
  "parse_pdf",
  "parse_docx",
  "parse_excel",
  "webserver_publish",
  "webserver_drop",
  "export_to_html",
  "activate_capability",
  "delegate_to_subagent",
  "create_agent_manifest",
  "create_skill_manifest",
  "create_capability_manifest",
  "list_available_agents",
  "list_available_skills",
  "list_available_capabilities",
  "system_exec",
  "shell_run",
  "rm_rf",
  "chmod",
]

// Disallowed network hosts
const DISALLOWED_HOSTS = [
  "evil.com",
  "exfil.attacker.io",
  "169.254.169.254",
  "localhost",
  "internal.corp",
  "192.168.1.1",
  "10.0.0.1",
  "172.16.0.1",
]

// ─── Helpers ─────────────────────────────────────────────────────────

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ─── Stress test ─────────────────────────────────────────────────────

// User source: empty allowed lists (no tools, no hosts)
const toolGuard = createToolWhitelistGuard(ALLOWED_TOOLS)
const netGuard = createNetworkGuard([]) // user source has no allowed hosts

let denied = 0
let allowed = 0
const errors: string[] = []

console.log(`\n🔒 Sandbox Stress Test — ${ITERATIONS} iterations\n`)

for (let i = 0; i < ITERATIONS; i++) {
  const toolName = randomFrom(DISALLOWED_TOOLS)
  const host = randomFrom(DISALLOWED_HOSTS)

  // Test 1: toolWhitelistGuard should deny disallowed tools
  if (!toolGuard.has(toolName)) {
    denied++
  } else {
    errors.push(`[iter ${i}] UNEXPECTED ALLOW: tool "${toolName}" should be denied`)
    allowed++
  }

  // Test 2: networkGuard should deny disallowed hosts
  if (!netGuard.has(host)) {
    denied++
  } else {
    errors.push(`[iter ${i}] UNEXPECTED ALLOW: host "${host}" should be denied`)
    allowed++
  }
}

// ─── Results ─────────────────────────────────────────────────────────

const total = ITERATIONS * 2 // tool + net per iteration
const denyRate = ((denied / total) * 100).toFixed(1)

console.log(`Total checks : ${total}`)
console.log(`Denied       : ${denied}`)
console.log(`Allowed      : ${allowed}`)
console.log(`Deny rate    : ${denyRate}%`)

if (errors.length > 0) {
  console.error("\n❌ Unexpected allows:")
  errors.forEach((e) => console.error("  " + e))
  process.exit(1)
}

if (denied !== total) {
  console.error(`\n❌ Expected 100% deny rate, got ${denyRate}%`)
  process.exit(1)
}

console.log("\n✅ All checks denied — sandbox is holding (100% deny rate)")
