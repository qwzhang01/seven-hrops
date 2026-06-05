#!/usr/bin/env node
/**
 * scripts/check-aisdk-versions.ts
 *
 * 校验本仓 AI SDK 依赖的运行时兼容性。
 *
 * 背景：本仓 Provider 协议适配层（runtime-multimodel-protocol-adapter）依赖
 * 多个 `@ai-sdk/*` sub-package。这些包**各自独立发版且 minor 号天然不齐**：
 *   - `@ai-sdk/openai`/`anthropic`/`google` 等官方一线包已升至 3.x（V3 协议）；
 *   - `@ai-sdk/openai-compatible`/`togetherai`/`deepinfra` 仍停留在 2.x（V2 协议）；
 *   - `@ai-sdk/alibaba` 等第三方包独立维护在 1.x。
 *
 * 经过 `scripts/aisdk-mixed-version-smoke.ts` 烟雾测试验证：`ai@6.x` 的
 * `streamText` 同时接受 V1/V2/V3 协议的模型实例。混用是 ai-sdk 生态常态，
 * 不是错误。
 *
 * 因此本脚本承担两类约束：
 *
 *   硬约束（exit 1）：
 *     - `ai` 主包必须存在且 major >= 6（V6 协议运行时是 multi-protocol 兼容的前提）。
 *
 *   软约束（warning, exit 0）：
 *     - `@ai-sdk/*` 各包 minor 不一致只打印 warning，方便人工识别协议族分布。
 *
 * 用法：
 *   pnpm run check:aisdk-versions
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")
const PKG_JSON = path.join(ROOT, "package.json")
const NODE_MODULES = path.join(ROOT, "node_modules")

// ─── 读 package.json，找到所有目标包名 ────────────────────────────────

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readPackageJson(file: string): PackageJson {
  const raw = fs.readFileSync(file, "utf-8")
  return JSON.parse(raw) as PackageJson
}

const rootPkg = readPackageJson(PKG_JSON)
const allDeps = { ...rootPkg.dependencies, ...rootPkg.devDependencies }

const targets = Object.keys(allDeps).filter(
  (name) =>
    name.startsWith("@ai-sdk/") || name === "@openrouter/ai-sdk-provider",
)

if (targets.length === 0) {
  console.log("ℹ️  No @ai-sdk/* or @openrouter/ai-sdk-provider deps declared. Skipping.")
  process.exit(0)
}

// ─── 从 node_modules 读真实安装版本 ──────────────────────────────────

interface PkgInfo {
  name: string
  declared: string
  installed: string | null
}

function readInstalledVersion(pkgName: string): string | null {
  const pkgFile = path.join(NODE_MODULES, pkgName, "package.json")
  if (!fs.existsSync(pkgFile)) return null
  try {
    const raw = fs.readFileSync(pkgFile, "utf-8")
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? null
  } catch {
    return null
  }
}

const infos: PkgInfo[] = targets.map((name) => ({
  name,
  declared: allDeps[name]!,
  installed: readInstalledVersion(name),
}))

// ─── 报告 ───────────────────────────────────────────────────────────

console.log("=== AI SDK package versions ===\n")
const colName = Math.max(...infos.map((i) => i.name.length), "package".length)
const padR = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length))
console.log(
  padR("package", colName) +
    "  " +
    padR("declared", 12) +
    "  " +
    padR("installed", 12),
)
console.log("-".repeat(colName + 30))
for (const info of infos) {
  console.log(
    padR(info.name, colName) +
      "  " +
      padR(info.declared, 12) +
      "  " +
      padR(info.installed ?? "<not installed>", 12),
  )
}
console.log()

// ─── minor 一致性断言（仅 @ai-sdk/*） ──────────────────────────────

const aiSdkInfos = infos.filter(
  (i) => i.name.startsWith("@ai-sdk/") && i.installed,
)

if (aiSdkInfos.length === 0) {
  console.log("⚠️  No @ai-sdk/* packages installed yet. Run `pnpm install` first.")
  process.exit(0)
}

function minorOf(version: string): string | null {
  // 处理 "3.0.18" / "3.0.0-beta.1" / "v3.0.0" 等形态
  const m = /^v?(\d+)\.(\d+)\./.exec(version)
  if (!m) return null
  return `${m[1]}.${m[2]}`
}

const minors = new Map<string, string[]>()
for (const info of aiSdkInfos) {
  const minor = minorOf(info.installed!)
  if (!minor) {
    console.error(`❌ Cannot parse minor from "${info.installed}" for ${info.name}`)
    process.exit(1)
  }
  if (!minors.has(minor)) minors.set(minor, [])
  minors.get(minor)!.push(info.name)
}

if (minors.size > 1) {
  console.warn("⚠️  @ai-sdk/* packages span multiple minor versions (this is normal):\n")
  for (const [minor, names] of minors) {
    console.warn(`   minor ${minor}: ${names.join(", ")}`)
  }
  console.warn(
    "\n   Verified by scripts/aisdk-mixed-version-smoke.ts — ai@6.x accepts mixed V1/V2/V3 protocols.\n",
  )
} else {
  const [theMinor] = [...minors.keys()]
  console.log(
    `✅ All @ai-sdk/* packages aligned at minor ${theMinor} (${aiSdkInfos.length} package(s))`,
  )
}

// ─── 硬约束：ai 主包必须 >= 6.0.0 ─────────────────────────────────

const aiMainVersion = readInstalledVersion("ai")
if (!aiMainVersion) {
  console.error(
    "\n❌ `ai` main package not installed. Run `pnpm install` first.",
  )
  process.exit(1)
}
const aiMajor = /^v?(\d+)\./.exec(aiMainVersion)?.[1]
if (!aiMajor || Number(aiMajor) < 6) {
  console.error(
    `\n❌ \`ai\` main package version ${aiMainVersion} is too old. The protocol adapter requires ai@^6.0.0 (V6 protocol runtime, supports mixed V1/V2/V3 model instances).`,
  )
  process.exit(1)
}
console.log(`✅ ai main package: ${aiMainVersion} (>= 6.0.0)`)
process.exit(0)
