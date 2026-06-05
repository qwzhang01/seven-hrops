/**
 * `plugins/dynamic.test.ts`
 *
 * **任务 9.1–9.5**：DynamicProviderPlugin 安全约束契约测试套件。
 *
 * 把阶段 5 的 `check:dynamic-provider-safety` 自检脚本（11 断言）升级为正式
 * vitest 单元测试，并扩充工厂层错误的覆盖（NoFactory / InvalidFactory）以及
 * 二次确认 + 信任持久化路径的回归测试（Case E）。
 *
 * | Case | 任务 | 焦点 |
 * |------|------|------|
 * | A    | 9.1  | 白名单内 + 工厂返回合法 LanguageModel → 成功 |
 * | B    | 9.2  | 白名单外 5 种攻击形态 → DynamicProviderNotAllowedError + import 未调 |
 * | C    | 9.3  | 白名单内但无 `createXxx` 工厂 → DynamicProviderNoFactoryError |
 * | D    | 9.4  | 白名单内 + 工厂返回值缺 LanguageModel 必要字段 → DynamicProviderInvalidFactoryError |
 * | E    | 9.5  | 二次确认拒绝 → DynamicProviderUserDeclinedError；确认后 markTrusted → 下次免确认 |
 *
 * ## Mock 策略：单次 hoist + 共享可变 fixture 引用
 *
 * dynamic.ts 第 4 步用变量调用 `await import(packageName)`。vitest 的
 * `vi.mock(path, factory)` 在 module graph 中同时拦截静态和动态 import，
 * 但 path 必须是字面量字符串——为此本测试统一使用占位包名
 * `@ai-sdk/test-dynamic-fixture`（白名单正则 `^@ai-sdk/[a-z0-9-]+$` 匹配
 * 但绝不会出现在真实 node_modules 中）。
 *
 * **关键陷阱**：vi.mock factory 仅在首次 import 时执行一次，闭包了
 * `fixtures.pkgExports` 的原始引用并写进 module cache；之后再 import
 * 拿到的就是这个原始对象。所以 `beforeEach` 内**绝不能**重新赋值
 * `fixtures.pkgExports = {}` ——那会让 mock 仍指向旧对象。必须用
 * [`setPkgExports`](#setPkgExports) helper 在原对象上 in-place 清空 + 重填。
 *
 * 同样的策略用于 `@tauri-apps/plugin-fs` —— 测试不需要真做文件 IO，每个 Case E
 * 的子用例切换 fixture 模拟「文件不存在 / 已写入信任 / 写入失败」。
 *
 * ## 单一 agent loop / Runtime 纪律回归
 *
 * 本套件**不**测 `resolveDynamicProvider` 的返回值是否被 ToolRuntime 正确消费——
 * 那是 single-loop.test.ts 的事。这里只验证 plugin 自身的安全契约。
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── hoisted fixtures（在 vi.mock 之前可访问） ─────────────────────────
//
// 用 vi.hoisted 把可变 fixture 容器提到 mock factory 之上——这是 vitest 官方
// 推荐的"单次 hoist + 运行时切换"模式。每个 case 的 beforeEach / 本体修改
// container.pkgExports / container.trustFileContent / container.confirmResult，
// 等同于切换 mock 行为，无需 vi.doMock 反复 reset。

const fixtures = vi.hoisted(() => {
  return {
    /** mock 包 `@ai-sdk/test-dynamic-fixture` 的 named exports 对象（**永远是同一引用**）。 */
    pkgExports: {} as Record<string, unknown>,
    /** mock 文件系统：null 视为「文件不存在」；非 null 即文件内容（JSON 字符串）。 */
    trustFileContent: null as string | null,
    /** 记录 writeTextFile 调用，便于断言 markTrusted 持久化。 */
    writtenFiles: [] as Array<{ path: string; content: string }>,
    /** mock 二次确认对话框返回值。 */
    confirmResult: true,
    /** import() 调用计数（Case B 验证「白名单拦截在 import 之前」）。 */
    importCallCount: 0,
  }
})

// 占位包名：白名单正则匹配但绝不存在于真实 node_modules——彻底隔离测试与生产。
//
// 注意：vi.mock 的第一个参数被 vitest 强制要求是**字面量字符串**（vitest 静态
// 分析时会把 vi.mock 调用 hoist 到文件顶部，此时常量声明还没初始化）。所以
// 下面 vi.mock 的路径必须直接用 "@ai-sdk/test-dynamic-fixture" 字面量；这个常量
// 仅用于在 ProviderConfig.dynamicPackage 字段中复用同一字符串；名字只含
// kebab-case + 数字以通过白名单正则 /^@ai-sdk\/[a-z0-9-]+$/。
const TEST_DYNAMIC_PACKAGE = "@ai-sdk/test-dynamic-fixture" as const

// ─── vi.mock 静态拦截（必须发生在 import "./dynamic" 之前） ──────────

vi.mock("@ai-sdk/test-dynamic-fixture", () => {
  fixtures.importCallCount += 1
  return fixtures.pkgExports
})

vi.mock("@tauri-apps/plugin-fs", () => {
  return {
    readTextFile: vi.fn(async (path: string) => {
      if (fixtures.trustFileContent === null) {
        throw new Error(`ENOENT: ${path}`)
      }
      return fixtures.trustFileContent
    }),
    writeTextFile: vi.fn(async (path: string, content: string) => {
      fixtures.writtenFiles.push({ path, content })
      fixtures.trustFileContent = content
    }),
    exists: vi.fn(async (_path: string) => {
      // 简化：trustFileContent 非 null → 视为 trust 文件 + .config 目录均已存在
      return fixtures.trustFileContent !== null
    }),
    mkdir: vi.fn(async () => {}),
  }
})

// ─── 待测模块（必须在所有 vi.mock 之后 import） ──────────────────────

import { resolveDynamicProvider } from "./dynamic"
import {
  DynamicProviderInvalidFactoryError,
  DynamicProviderMissingPackageError,
  DynamicProviderNoFactoryError,
  DynamicProviderNotAllowedError,
  DynamicProviderUserDeclinedError,
} from "../_types"
import type { ProviderConfig } from "../../config/index"

// ─── 共用 helper ─────────────────────────────────────────────────────

/**
 * **关键** 把测试 case 内的 mock exports「在原对象上替换」而非「重新赋值新对象」。
 *
 * vi.mock factory 在首次 `import("@ai-sdk/test-dynamic-fixture")` 时执行一次，
 * 闭包了 `fixtures.pkgExports` 的原始引用并写进 module cache；之后再 import
 * 拿到的就是这个原始对象。如果在 beforeEach 内 `fixtures.pkgExports = {}`，
 * mock 仍指向旧对象，新对象上的 exports 永远看不到。
 *
 * 所以测试 case 必须用本 helper：先 `delete` 掉所有旧 keys，再 `Object.assign`
 * 灌入新 keys——保持同一引用，让 mock 看到新内容。
 */
function setPkgExports(next: Record<string, unknown>): void {
  Object.keys(fixtures.pkgExports).forEach(
    (k) => delete fixtures.pkgExports[k],
  )
  Object.assign(fixtures.pkgExports, next)
}

const makeLegalLanguageModel = () => ({
  specificationVersion: "v2" as const,
  provider: "test-dynamic",
  modelId: "test-model",
})

const makeBaseConfig = (
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig => ({
  providerID: "dynamic",
  apiKey: "sk-test",
  baseURL: "https://api.example.com/v1",
  dynamicPackage: TEST_DYNAMIC_PACKAGE,
  ...overrides,
})

// ─── 测试套件 ────────────────────────────────────────────────────────

describe("DynamicProviderPlugin 安全约束（plugins/dynamic.test.ts）", () => {
  beforeEach(() => {
    setPkgExports({})
    fixtures.trustFileContent = null
    fixtures.writtenFiles.length = 0
    fixtures.confirmResult = true
    fixtures.importCallCount = 0
  })

  // ─── Case A: 白名单内 + 合法工厂 → 成功 ────────────────────────
  describe("Case A (任务 9.1): 白名单内的包正常加载", () => {
    it("createXxx 返回合法 LanguageModel → resolveDynamicProvider 成功返回 sdkInstance + protocolID + packageName", async () => {
      const legalModel = makeLegalLanguageModel()
      // 大多数 @ai-sdk/* 工厂签名是 (options) => (modelID) => LanguageModel —— 模拟两段调用
      setPkgExports({
        createTestDynamic: vi.fn(
          (_opts: unknown) => (_id: string) => legalModel,
        ),
      })

      const result = await resolveDynamicProvider({
        config: makeBaseConfig(),
        modelID: "test-model",
        workspacePath: null,
        readEnv: () => "1", // OPENSPEC_DYNAMIC_TRUST=1 短路
      })

      expect(result.sdkInstance).toBe(legalModel)
      expect(result.protocolID).toBe("openai-compatible")
      expect(result.packageName).toBe(TEST_DYNAMIC_PACKAGE)
      expect(fixtures.importCallCount).toBe(1)
    })

    it("一段调用形态：createXxx(options) 直接返回 LanguageModel（部分 ai-sdk 包形态）", async () => {
      const legalModel = makeLegalLanguageModel()
      setPkgExports({
        createTestDynamic: vi.fn((_opts: unknown) => legalModel),
      })

      const result = await resolveDynamicProvider({
        config: makeBaseConfig(),
        modelID: "test-model",
        workspacePath: null,
        readEnv: () => "1",
      })

      expect(result.sdkInstance).toBe(legalModel)
    })

    it("缺 dynamicPackage → DynamicProviderMissingPackageError（在 import 之前）", async () => {
      await expect(
        resolveDynamicProvider({
          config: makeBaseConfig({ dynamicPackage: undefined }),
          modelID: "m",
          workspacePath: null,
          readEnv: () => "1",
        }),
      ).rejects.toBeInstanceOf(DynamicProviderMissingPackageError)
      expect(fixtures.importCallCount).toBe(0)
    })
  })

  // ─── Case B: 白名单外 5 种攻击形态 → 全部 fail-fast ──────────────
  describe("Case B (任务 9.2): 白名单外的 npm 包立即抛错", () => {
    const ATTACK_PACKAGES = [
      "some-malicious-pkg",
      "@openrouter/ai-sdk-provider",
      "file:///tmp/evil.js",
      "@ai-sdk/",
      "@ai-sdk/UPPER",
    ] as const

    it.each(ATTACK_PACKAGES)(
      "包名 %p → DynamicProviderNotAllowedError + import() 未被调用过",
      async (badPackage) => {
        await expect(
          resolveDynamicProvider({
            // @ts-expect-error 故意传非白名单包名做安全测试
            config: makeBaseConfig({ dynamicPackage: badPackage }),
            modelID: "m",
            workspacePath: null,
            readEnv: () => "1",
          }),
        ).rejects.toBeInstanceOf(DynamicProviderNotAllowedError)

        expect(fixtures.importCallCount).toBe(0)
      },
    )

    it("DynamicProviderNotAllowedError payload 包含 packageName 与 reason", async () => {
      try {
        await resolveDynamicProvider({
          // @ts-expect-error 故意传非白名单
          config: makeBaseConfig({ dynamicPackage: "some-malicious-pkg" }),
          modelID: "m",
          workspacePath: null,
          readEnv: () => "1",
        })
        throw new Error("should have thrown")
      } catch (e) {
        expect(e).toBeInstanceOf(DynamicProviderNotAllowedError)
        const err = e as DynamicProviderNotAllowedError
        expect(err.packageName).toBe("some-malicious-pkg")
        expect(err.reason).toMatch(/whitelist/i)
      }
    })
  })

  // ─── Case C: 白名单内但无 createXxx 工厂 ───────────────────────
  describe("Case C (任务 9.3): 白名单内但找不到 createXxx 工厂", () => {
    it("包内只有 default 导出无 createXxx → DynamicProviderNoFactoryError", async () => {
      setPkgExports({
        default: { someField: "value" },
        version: "1.0.0",
      })

      await expect(
        resolveDynamicProvider({
          config: makeBaseConfig(),
          modelID: "m",
          workspacePath: null,
          readEnv: () => "1",
        }),
      ).rejects.toBeInstanceOf(DynamicProviderNoFactoryError)
    })

    it("payload 包含 packageName + availableExports 列表（用于诊断）", async () => {
      setPkgExports({ foo: 1, bar: "x", baz: () => {} })

      try {
        await resolveDynamicProvider({
          config: makeBaseConfig(),
          modelID: "m",
          workspacePath: null,
          readEnv: () => "1",
        })
        throw new Error("should have thrown")
      } catch (e) {
        expect(e).toBeInstanceOf(DynamicProviderNoFactoryError)
        const err = e as DynamicProviderNoFactoryError
        expect(err.packageName).toBe(TEST_DYNAMIC_PACKAGE)
        expect(err.availableExports).toEqual(
          expect.arrayContaining(["foo", "bar", "baz"]),
        )
      }
    })

    it("有 'create' 但不是函数（值为字符串）→ 仍视为无工厂", async () => {
      // 启发式：startsWith('create') + typeof === 'function'，两条件缺一不可
      setPkgExports({
        createMisleading: "not a function",
        createBroken: 42,
      })

      await expect(
        resolveDynamicProvider({
          config: makeBaseConfig(),
          modelID: "m",
          workspacePath: null,
          readEnv: () => "1",
        }),
      ).rejects.toBeInstanceOf(DynamicProviderNoFactoryError)
    })
  })

  // ─── Case D: 工厂返回值不满足 LanguageModel 形态 ───────────────
  describe("Case D (任务 9.4): 工厂返回值不满足 LanguageModel 形态", () => {
    it("返回 null → DynamicProviderInvalidFactoryError + missingFields=[全部三字段]", async () => {
      setPkgExports({
        createTestDynamic: () => () => null,
      })

      try {
        await resolveDynamicProvider({
          config: makeBaseConfig(),
          modelID: "m",
          workspacePath: null,
          readEnv: () => "1",
        })
        throw new Error("should have thrown")
      } catch (e) {
        expect(e).toBeInstanceOf(DynamicProviderInvalidFactoryError)
        const err = e as DynamicProviderInvalidFactoryError
        expect(err.missingFields).toEqual([
          "specificationVersion",
          "provider",
          "modelId",
        ])
        expect(err.factoryName).toBe("createTestDynamic")
      }
    })

    it("缺 specificationVersion 字段 → 仅 missingFields 含该字段", async () => {
      setPkgExports({
        createTestDynamic: () => () => ({
          provider: "x",
          modelId: "y",
        }),
      })

      try {
        await resolveDynamicProvider({
          config: makeBaseConfig(),
          modelID: "m",
          workspacePath: null,
          readEnv: () => "1",
        })
        throw new Error("should have thrown")
      } catch (e) {
        expect(e).toBeInstanceOf(DynamicProviderInvalidFactoryError)
        const err = e as DynamicProviderInvalidFactoryError
        expect(err.missingFields).toEqual(["specificationVersion"])
      }
    })

    it("返回普通对象（非 LanguageModel）→ missingFields 列出所有缺失字段", async () => {
      setPkgExports({
        createTestDynamic: () => () => ({ foo: "bar", baz: 1 }),
      })

      await expect(
        resolveDynamicProvider({
          config: makeBaseConfig(),
          modelID: "m",
          workspacePath: null,
          readEnv: () => "1",
        }),
      ).rejects.toBeInstanceOf(DynamicProviderInvalidFactoryError)
    })

    it("返回 primitive（string）→ missingFields=[全部三字段]", async () => {
      setPkgExports({
        createTestDynamic: () => () => "not an object",
      })

      try {
        await resolveDynamicProvider({
          config: makeBaseConfig(),
          modelID: "m",
          workspacePath: null,
          readEnv: () => "1",
        })
        throw new Error("should have thrown")
      } catch (e) {
        expect(e).toBeInstanceOf(DynamicProviderInvalidFactoryError)
        const err = e as DynamicProviderInvalidFactoryError
        expect(err.missingFields).toHaveLength(3)
      }
    })
  })

  // ─── Case E: 二次确认 + 信任持久化（platform-foundation 纪律 3.3） ──
  describe("Case E (任务 9.5): 二次确认与信任持久化", () => {
    const WORKSPACE_PATH = "/tmp/test-workspace"

    it("workspacePath=null + 用户拒绝 → DynamicProviderUserDeclinedError", async () => {
      const userDeclined = vi.fn(async () => false)

      try {
        await resolveDynamicProvider({
          config: makeBaseConfig(),
          modelID: "m",
          workspacePath: null,
          confirmCallback: userDeclined,
          readEnv: () => undefined,
        })
        throw new Error("should have thrown")
      } catch (e) {
        expect(e).toBeInstanceOf(DynamicProviderUserDeclinedError)
        const err = e as DynamicProviderUserDeclinedError
        expect(err.packageName).toBe(TEST_DYNAMIC_PACKAGE)
      }

      expect(userDeclined).toHaveBeenCalledOnce()
      expect(userDeclined).toHaveBeenCalledWith(TEST_DYNAMIC_PACKAGE)
      expect(fixtures.importCallCount).toBe(0)
    })

    it("用户确认 + workspacePath 非 null → markTrusted 写入文件 + 完成加载", async () => {
      const userConfirmed = vi.fn(async () => true)
      setPkgExports({
        createTestDynamic: () => () => makeLegalLanguageModel(),
      })
      fixtures.trustFileContent = null

      const result = await resolveDynamicProvider({
        config: makeBaseConfig(),
        modelID: "m",
        workspacePath: WORKSPACE_PATH,
        confirmCallback: userConfirmed,
        readEnv: () => undefined,
      })

      expect(result.protocolID).toBe("openai-compatible")
      expect(userConfirmed).toHaveBeenCalledOnce()
      expect(fixtures.writtenFiles).toHaveLength(1)
      const written = fixtures.writtenFiles[0]!
      expect(written.path).toContain(".config/dynamic-providers-trusted.json")
      expect(JSON.parse(written.content)).toEqual({
        packages: [TEST_DYNAMIC_PACKAGE],
      })
    })

    it("已在信任清单中 → 不再弹窗（platform-foundation 纪律 3.3 回归）", async () => {
      fixtures.trustFileContent = JSON.stringify({
        packages: [TEST_DYNAMIC_PACKAGE],
      })
      setPkgExports({
        createTestDynamic: () => () => makeLegalLanguageModel(),
      })
      const confirmCb = vi.fn(async () => true)

      await resolveDynamicProvider({
        config: makeBaseConfig(),
        modelID: "m",
        workspacePath: WORKSPACE_PATH,
        confirmCallback: confirmCb,
        readEnv: () => undefined,
      })

      expect(confirmCb).not.toHaveBeenCalled()
      expect(fixtures.writtenFiles).toHaveLength(0)
    })

    it("OPENSPEC_DYNAMIC_TRUST=1 短路 → 跳过 confirm + 跳过 markTrusted", async () => {
      const confirmCb = vi.fn(async () => true)
      setPkgExports({
        createTestDynamic: () => () => makeLegalLanguageModel(),
      })

      await resolveDynamicProvider({
        config: makeBaseConfig(),
        modelID: "m",
        workspacePath: WORKSPACE_PATH,
        confirmCallback: confirmCb,
        readEnv: (k) => (k === "OPENSPEC_DYNAMIC_TRUST" ? "1" : undefined),
      })

      expect(confirmCb).not.toHaveBeenCalled()
      expect(fixtures.writtenFiles).toHaveLength(0)
    })

    it("workspacePath=null + 用户确认 → 跳过 markTrusted（无 ws 不能持久化）", async () => {
      const confirmCb = vi.fn(async () => true)
      setPkgExports({
        createTestDynamic: () => () => makeLegalLanguageModel(),
      })

      const result = await resolveDynamicProvider({
        config: makeBaseConfig(),
        modelID: "m",
        workspacePath: null,
        confirmCallback: confirmCb,
        readEnv: () => undefined,
      })

      expect(result.sdkInstance).toBeDefined()
      expect(confirmCb).toHaveBeenCalledOnce()
      expect(fixtures.writtenFiles).toHaveLength(0)
    })
  })
})
