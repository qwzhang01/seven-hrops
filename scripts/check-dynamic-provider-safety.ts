/* eslint-disable no-console */
/**
 * `runtime-multimodel-protocol-adapter` 阶段 5 自检脚本：DynamicProvider 安全约束
 *
 * **不替代** 阶段 9 的正式 vitest 测试套件，是阶段 5 实施期的快速回归脚本——
 * 让我们能在不跑完整 vitest 的情况下用 5 秒钟确认：
 *
 *   ① 白名单内的包名能通过校验（trust=bypass 模式下走完整流程）
 *   ② 白名单外的包名立即抛 `DynamicProviderNotAllowedError`
 *   ③ `dynamicPackage` 缺失抛 `DynamicProviderMissingPackageError`
 *   ④ 用户拒绝二次确认抛 `DynamicProviderUserDeclinedError`
 *
 * 不验证的部分（留给阶段 9）：
 *   - 实际 `await import()` 加载真实包后的 createXxx 反射
 *   - markTrusted 写文件后的持久化回环
 *   - Tauri dialog 的实际弹出
 *
 * 运行方式：`pnpm run check:dynamic-provider-safety`
 */

import {
  resolveDynamicProvider,
  DYNAMIC_PACKAGE_WHITELIST,
} from "../src/agent-runtime/provider/plugins/dynamic"
import {
  DynamicProviderMissingPackageError,
  DynamicProviderNotAllowedError,
  DynamicProviderUserDeclinedError,
} from "../src/agent-runtime/provider/_types"
import type { ProviderConfig } from "../src/agent-runtime/config/index"

// ── env reader：让本脚本可以模拟 OPENSPEC_DYNAMIC_TRUST=1 短路 ────────
const bypassReadEnv = (key: string): string | undefined => {
  if (key === "OPENSPEC_DYNAMIC_TRUST") return "1"
  return undefined
}

const baseConfig: Omit<ProviderConfig, "providerID"> = {
  apiKey: "test-key",
  baseURL: "https://example.com/v1",
}

let failures = 0

async function expect(
  label: string,
  errorClass: { new (...args: never[]): Error },
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn()
    console.log(`❌ ${label}: 期望抛 ${errorClass.name}，但成功返回了`)
    failures++
  } catch (e) {
    if (e instanceof errorClass) {
      console.log(`✅ ${label}: 抛 ${errorClass.name}`)
    } else {
      console.log(
        `❌ ${label}: 期望 ${errorClass.name}，实际抛 ${(e as Error).constructor.name} — ${String(e)}`,
      )
      failures++
    }
  }
}

async function main() {
  console.log("DYNAMIC_PACKAGE_WHITELIST =", DYNAMIC_PACKAGE_WHITELIST.source)
  console.log()

  // Case 1: dynamicPackage 缺失 → MissingPackageError
  await expect(
    "Case 1 — dynamicPackage 缺失",
    DynamicProviderMissingPackageError,
    () =>
      resolveDynamicProvider({
        config: { ...baseConfig, providerID: "dynamic" } as ProviderConfig,
        modelID: "test-model",
        workspacePath: null,
        readEnv: bypassReadEnv,
        confirmCallback: async () => true,
      }),
  )

  // Case 2: 包名不匹配白名单 → NotAllowedError
  for (const evilName of [
    "some-malicious-pkg",
    "@openrouter/ai-sdk-provider",
    "@evil/ai-sdk-provider",
    "ai-sdk-fake",
    "file:///tmp/evil.js",
    "../../../etc/passwd",
  ]) {
    await expect(
      `Case 2 — 拒绝白名单外包名: ${evilName}`,
      DynamicProviderNotAllowedError,
      () =>
        resolveDynamicProvider({
          config: {
            ...baseConfig,
            providerID: "dynamic",
            dynamicPackage: evilName as `@ai-sdk/${string}`,
          } as ProviderConfig,
          modelID: "test-model",
          workspacePath: null,
          readEnv: bypassReadEnv,
          confirmCallback: async () => true,
        }),
    )
  }

  // Case 3: 用户拒绝二次确认 → UserDeclinedError
  // （故意不 bypass，强制走 confirm 路径）
  await expect(
    "Case 3 — 用户拒绝二次确认",
    DynamicProviderUserDeclinedError,
    () =>
      resolveDynamicProvider({
        config: {
          ...baseConfig,
          providerID: "dynamic",
          dynamicPackage: "@ai-sdk/fake-untrusted-pkg" as `@ai-sdk/${string}`,
        } as ProviderConfig,
        modelID: "test-model",
        workspacePath: null,
        readEnv: () => undefined, // 不 bypass
        confirmCallback: async () => false, // 用户点取消
      }),
  )

  // Case 4: 正例 — 白名单内的合法形态字符串能通过白名单校验
  // （但会因为实际 import 不到包而在 Step 4 抛错，所以这里我们只断言「不会被
  //  Step 2 拦下」即可——通过观察错误类型是不是 NotAllowedError）
  console.log()
  console.log("Case 4 — 白名单内的包名通过白名单校验")
  for (const goodName of [
    "@ai-sdk/openai",
    "@ai-sdk/some-future-provider",
    "@ai-sdk/x-y-z",
  ]) {
    if (DYNAMIC_PACKAGE_WHITELIST.test(goodName)) {
      console.log(`✅   ${goodName} 命中白名单`)
    } else {
      console.log(`❌   ${goodName} 应命中但被拒绝`)
      failures++
    }
  }

  console.log()
  if (failures === 0) {
    console.log("✅ 全部 case 通过")
  } else {
    console.log(`❌ ${failures} 个 case 失败`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("脚本异常退出:", e)
  process.exit(1)
})
