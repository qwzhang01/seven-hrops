/**
 * Platform — Dynamic Provider Trust
 *
 * 维护「用户已确认信任的 dynamic provider npm 包」清单。配合
 * [`agent-runtime/provider/plugins/dynamic.ts`](../agent-runtime/provider/plugins/dynamic.ts)
 * 实现 `runtime-multimodel-protocol-adapter` capability 的「首次加载二次确认」
 * 安全约束（platform-foundation 纪律 3.3）。
 *
 * ## 持久化路径
 *
 * 信任清单写入 [`<workspacePath>/.config/dynamic-providers-trusted.json`](../../)，
 * 格式：
 *
 * ```json
 * { "packages": ["@ai-sdk/some-provider", "@ai-sdk/another"] }
 * ```
 *
 * **workspace 级而非应用级**：每个 workspace 独立维护，避免一个项目的信任决策
 * 跨项目泄露；这与本仓 `arch-capability-agent-contract` 纪律「workspace 是
 * data + trust 边界」一致。
 *
 * ## 短路开关
 *
 * 在 CLI / 测试 / CI 场景下，`OPENSPEC_DYNAMIC_TRUST=1` 环境变量 SHALL 让
 * `checkTrust` 返回 `true` 而无需读文件——避免在无头环境下 hang 等用户确认。
 *
 * ## 分层纪律
 *
 * 本模块**不**直接 import `useWorkspaceStore`：workspace path 由调用方
 * （[`plugins/dynamic.ts`](../agent-runtime/provider/plugins/dynamic.ts)）通过
 * 参数显式注入，保持 platform 层与前端 store 解耦——这与 [`runtimeConfig.ts`](./runtimeConfig.ts)
 * 仅 `import type` 而非 runtime import 的策略一致。
 *
 * 同时本模块**不**通过 [`toolRegistry`](./registry/toolRegistry.ts) 走 L2→L1：
 * trust 文件读写属于平台基础设施级 IO（在 ProviderRegistry 解析路径上比 session
 * 更底层），与 [`PlatformBootError.tsx`](../components/PlatformBootError.tsx) 直接
 * `invoke("open_audit_log")` 的先例一致。该决策记录在 [`design.md`](../../openspec/changes/runtime-multimodel-protocol-adapter/design.md)
 * Decision 9。
 */

// ─── Types ────────────────────────────────────────────────────────────

import type { DynamicPackage } from "../agent-runtime/provider/_types"

/**
 * 信任清单文件 schema。当前版本仅有 `packages` 一个字段；保留对象形态便于
 * 未来扩展（例如：`packages: Array<{ name, addedAt, version }>`、`schemaVersion`）。
 */
export interface DynamicProviderTrustList {
  packages: readonly DynamicPackage[]
}

/**
 * `checkTrust` / `markTrusted` 的依赖注入参数。
 */
export interface TrustOptions {
  /**
   * 当前 workspace 绝对路径。null 表示尚未选定 workspace——此时 SHALL 不进行
   * 任何文件 IO，直接以「不信任」的态度返回（`checkTrust → false`），由调用方
   * 决定是否继续 prompt 用户。
   */
  readonly workspacePath: string | null
  /**
   * 环境变量读取器。生产环境传 `() => import.meta.env`（Vite）或 `() => process.env`
   * （Node 测试），默认走 `import.meta.env`。
   *
   * 该字段存在的理由：Vite 的 `import.meta.env` 是 build-time 静态注入，
   * test runner 下用 `process.env` 才能动态读取——通过注入 reader 让测试环境
   * 能模拟 `OPENSPEC_DYNAMIC_TRUST=1`。
   */
  readonly readEnv?: (key: string) => string | undefined
}

// ─── Constants ────────────────────────────────────────────────────────

/** 信任清单 JSON 文件相对路径（相对 workspace root）。 */
export const TRUST_FILE_RELATIVE_PATH = ".config/dynamic-providers-trusted.json"

/** 短路开关环境变量名。 */
export const TRUST_BYPASS_ENV_VAR = "OPENSPEC_DYNAMIC_TRUST"

// ─── Internal helpers ─────────────────────────────────────────────────

const defaultEnvReader = (key: string): string | undefined => {
  // 优先 process.env（Node / Vitest）
  if (typeof process !== "undefined" && process.env) {
    return process.env[key]
  }
  // 浏览器环境无法读 env，返回 undefined
  return undefined
}

const isBypassEnabled = (readEnv: (key: string) => string | undefined): boolean => {
  const v = readEnv(TRUST_BYPASS_ENV_VAR)
  return v === "1" || v === "true"
}

const trustFileAbsPath = (workspacePath: string): string =>
  `${workspacePath}/${TRUST_FILE_RELATIVE_PATH}`

/**
 * 通过 `@tauri-apps/plugin-fs` 读取信任清单文件。文件不存在 / 解析失败 / 形态不
 * 合法时统一降级返回空清单——「未明确信任 = 默认不信任」是更安全的语义。
 *
 * 异步 import 的目的：避免在非 Tauri 环境（Node 单测）启动时直接 import 失败；
 * 由调用方（test）通过 `vi.mock("@tauri-apps/plugin-fs", ...)` 在用例内 mock。
 */
async function readTrustListFromDisk(
  workspacePath: string,
): Promise<DynamicProviderTrustList> {
  try {
    const { readTextFile, exists } = await import("@tauri-apps/plugin-fs")
    const path = trustFileAbsPath(workspacePath)
    if (!(await exists(path))) {
      return { packages: [] }
    }
    const raw = await readTextFile(path)
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "packages" in parsed &&
      Array.isArray((parsed as DynamicProviderTrustList).packages)
    ) {
      return parsed as DynamicProviderTrustList
    }
    return { packages: [] }
  } catch {
    // Tauri 不可用 / 文件损坏 / 解析失败：默认空清单（fail-safe）
    return { packages: [] }
  }
}

/**
 * 通过 `@tauri-apps/plugin-fs` 写入信任清单。会先确保 `.config/` 目录存在。
 * 写失败会向上抛出——这与 read 路径的「fail-safe」语义不同：写失败意味着
 * 用户的确认决策无法持久化，应让上层感知。
 */
async function writeTrustListToDisk(
  workspacePath: string,
  list: DynamicProviderTrustList,
): Promise<void> {
  const { writeTextFile, mkdir, exists } = await import("@tauri-apps/plugin-fs")
  const dir = `${workspacePath}/.config`
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true })
  }
  await writeTextFile(
    trustFileAbsPath(workspacePath),
    JSON.stringify(list, null, 2),
  )
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * 检查某个白名单内的 npm 包是否已被用户信任。
 *
 * 解析顺序：
 *   1. `OPENSPEC_DYNAMIC_TRUST=1` → 直接返回 `true`（CLI/测试短路）
 *   2. `workspacePath === null` → 返回 `false`（无 workspace 上下文，由调用方
 *      决定是否仍然 prompt）
 *   3. 读 `<workspacePath>/.config/dynamic-providers-trusted.json` → 包名是否
 *      在 `packages` 数组中
 *
 * **该函数本身不抛错**：所有 IO/解析失败路径降级为 `false`（默认不信任更安全）。
 *
 * @param packageName 已通过白名单校验的 npm 包名（`@ai-sdk/xxx`）
 * @param options    workspace 上下文 + env reader（可选）
 */
export async function checkTrust(
  packageName: DynamicPackage,
  options: TrustOptions,
): Promise<boolean> {
  const readEnv = options.readEnv ?? defaultEnvReader
  if (isBypassEnabled(readEnv)) {
    return true
  }
  if (options.workspacePath === null) {
    return false
  }
  const list = await readTrustListFromDisk(options.workspacePath)
  return list.packages.includes(packageName)
}

/**
 * 把某个包名写入信任清单（幂等：已在清单中则不重写避免触发 fs watcher）。
 *
 * 与 `checkTrust` 不同——此函数会**向上抛出**底层 `@tauri-apps/plugin-fs` 错误，
 * 让调用方感知"用户的信任决策没保存"，避免下次启动还要再问一次。
 *
 * @throws Error 若 `workspacePath === null`（无 workspace 时不应调用此函数）
 */
export async function markTrusted(
  packageName: DynamicPackage,
  options: TrustOptions,
): Promise<void> {
  if (options.workspacePath === null) {
    throw new Error(
      `dynamicProviderTrust.markTrusted: workspacePath is null; cannot persist trust for ${packageName}`,
    )
  }
  const list = await readTrustListFromDisk(options.workspacePath)
  if (list.packages.includes(packageName)) {
    return
  }
  const next: DynamicProviderTrustList = {
    packages: [...list.packages, packageName],
  }
  await writeTrustListToDisk(options.workspacePath, next)
}

/**
 * 读取完整信任清单（供 UI 展示用，例如「已信任的 dynamic provider」设置面板）。
 *
 * 与 `checkTrust` 共享降级语义：失败返回空清单。
 */
export async function loadTrustList(
  options: TrustOptions,
): Promise<DynamicProviderTrustList> {
  const readEnv = options.readEnv ?? defaultEnvReader
  if (isBypassEnabled(readEnv)) {
    // bypass 模式下 UI 不应展示「全部已信任」的误导信息；返回空清单更准确
    return { packages: [] }
  }
  if (options.workspacePath === null) {
    return { packages: [] }
  }
  return readTrustListFromDisk(options.workspacePath)
}

/**
 * 通过 Tauri 原生 `confirm` 对话框向用户请求二次确认。
 *
 * 由 [`plugins/dynamic.ts`](../agent-runtime/provider/plugins/dynamic.ts) 在
 * `checkTrust → false` 后调用；用户确认后由 plugin 调用 `markTrusted` 持久化。
 *
 * 测试场景下应通过 `vi.mock("@tauri-apps/plugin-dialog", ...)` mock。
 *
 * @returns 用户点了「确认」返回 `true`，点了「取消」或 ESC 返回 `false`
 */
export async function requestUserConfirmation(
  packageName: DynamicPackage,
): Promise<boolean> {
  const { confirm } = await import("@tauri-apps/plugin-dialog")
  return confirm(
    `即将通过 npm 安装并加载 ${packageName}，是否继续？\n\n请确认该包来源可信。`,
    {
      title: "动态 Provider 信任确认",
      kind: "warning",
      okLabel: "信任并加载",
      cancelLabel: "取消",
    },
  )
}
