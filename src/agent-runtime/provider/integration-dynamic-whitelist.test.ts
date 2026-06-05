/**
 * runtime-multimodel-protocol-adapter / 阶段 11 — Dynamic Provider 端到端白名单测试。
 *
 * 守住的不变量：**端到端配置加载场景**下，白名单内/外的 npm 包名经过完整
 * `Provider.Service.createModelAdapter` 链路（Config → Service Layer →
 * defaultProviderRegistry → resolveDynamicProvider）后行为符合预期。
 *
 * ## 与现有 dynamic 测试的差异
 *
 * | 测试文件                                     | 测试粒度                     |
 * |---------------------------------------------|------------------------------|
 * | [dynamic.test.ts](./plugins/dynamic.test.ts) | resolveDynamicProvider 单元（直接调 resolver） |
 * | [registry.test.ts](./registry.test.ts)       | registry 路由分发（resolveDynamicProvider 被 vi.mock 替换） |
 * | **本文件**                                   | **完整 Provider.Service Layer**（不 mock resolver，验真实端到端） |
 *
 * ## 测试策略
 *
 * - **占位包名** `@ai-sdk/test-dynamic-fixture` —— 同 dynamic.test.ts，避免污染
 *   生产依赖；vi.mock 拦截 dynamic import 让占位包导出可控的 fake 工厂。
 * - **Trust 短路** —— 在 Case A 通过 `process.env.OPENSPEC_DYNAMIC_TRUST=1`
 *   让 [`checkTrust`](../../platform/dynamicProviderTrust.ts) 直接放行，避开
 *   `workspacePath === null`（因为 Provider Service 不传 workspacePath）→
 *   直接 false 的链路，从而跳过 confirm 调用。
 * - **mock dialog** —— vi.mock `requestUserConfirmation` 模块兜底，确保任何
 *   confirm 调用都走 mock 路径（黑名单 case 在 fail-fast 之前不应该触发）。
 *
 * ## 守护场景
 *
 * - **A. 白名单内**：`dynamicPackage = "@ai-sdk/test-dynamic-fixture"` →
 *   service.createModelAdapter 成功返回 ModelAdapter（端到端打通）
 * - **B. 白名单外**：`dynamicPackage = "evil-pkg"` → service.createModelAdapter
 *   失败（fail in Effect channel，Effect 错误 message 含 NotAllowedError）
 * - **C. 缺失 dynamicPackage 字段**：
 *   `providerID === "dynamic"` 但 `config.dynamicPackage` undefined →
 *   service.createModelAdapter 失败（MissingPackageError）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"

// ─── hoisted fixtures（vi.mock factory 闭包共享） ──────────────────────

const fixtures = {
  pkgExports: {} as Record<string, unknown>,
  trustFileContent: null as string | null,
  writtenFiles: [] as Array<{ path: string; content: string }>,
}

// ─── vi.mock 静态拦截 ────────────────────────────────────────────────

// 占位 npm 包（与 dynamic.test.ts 共用相同包名以共享拦截规则）
vi.mock("@ai-sdk/test-dynamic-fixture", () => fixtures.pkgExports)

// Tauri fs：用 in-memory 模拟 trust 文件存储
vi.mock("@tauri-apps/plugin-fs", () => ({
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
  exists: vi.fn(async () => fixtures.trustFileContent !== null),
  mkdir: vi.fn(async () => {}),
}))

// dialog：本测试通过 trust 预置避免触发 confirm，但仍 mock 防漏
vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(async () => false), // 默认拒绝，作为 safety net
}))

// ─── 待测：完整 Provider.Service Layer ────────────────────────────────

import { Provider } from "./index"
import { Config, type AgentRuntimeConfig } from "../config/index"
import { Layer } from "effect"

// ─── helper：构造完整 Service Layer ───────────────────────────────────

/**
 * 用给定 AgentRuntimeConfig 构造 `Provider.Service`，绕过 defaultLayer 中
 * 真实的 Config 持久化层（避免触碰 disk）。
 */
function makeProviderService(cfg: AgentRuntimeConfig) {
  const layer = Provider.layer.pipe(Layer.provide(Config.layer(cfg)))
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* Provider.Service
      }).pipe(Effect.provide(layer)),
    ),
  )
}

// ─── 测试 ────────────────────────────────────────────────────────────

describe("integration-dynamic-whitelist / 端到端配置加载", () => {
  // **全局 trust 短路**：用 OPENSPEC_DYNAMIC_TRUST=1 让 checkTrust 直接放行。
  // 这是必要的——Provider.Service.createModelAdapter 链路不传 workspacePath，
  // 导致 checkTrust 的 `workspacePath === null` 分支直接返回 false，
  // 再进入 confirmCallback 而被 mock 的 dialog 拒绝。env bypass 是
  // [`checkTrust`](../../platform/dynamicProviderTrust.ts) 文档第 1 条
  // 短路条件，本测试场景下复用合理。
  let originalTrustEnv: string | undefined

  beforeEach(() => {
    fixtures.pkgExports = {}
    fixtures.trustFileContent = null
    fixtures.writtenFiles = []
    originalTrustEnv = process.env.OPENSPEC_DYNAMIC_TRUST
    process.env.OPENSPEC_DYNAMIC_TRUST = "1"
  })

  afterEach(() => {
    if (originalTrustEnv === undefined) {
      delete process.env.OPENSPEC_DYNAMIC_TRUST
    } else {
      process.env.OPENSPEC_DYNAMIC_TRUST = originalTrustEnv
    }
  })

  // ── Case A: 白名单内的占位包 + trust 已预置 → 成功创建 adapter ──────

  it("A. 白名单内包名 + trust 预置 → service.createModelAdapter 成功", async () => {
    // 1. 占位包导出一个合法的 createXxx 工厂
    fixtures.pkgExports = {
      createTestDynamicFixture: vi.fn((options: { apiKey?: string }) => () => ({
        // 工厂返回 LanguageModel 形态（最小契约：specificationVersion / provider / modelId）
        specificationVersion: "v3" as const,
        provider: "test-dynamic-fixture",
        modelId: options.apiKey ?? "default",
      })),
    }

    // 2. 构造 AgentRuntimeConfig，dynamicPackage 指向占位包
    const config: AgentRuntimeConfig = {
      providers: {
        dynamic: {
          apiKey: "test-key",
          baseURL: undefined,
          dynamicPackage: "@ai-sdk/test-dynamic-fixture",
          protocol: "openai-compatible",
          models: undefined,
          promptStyle: null,
        } as Parameters<typeof Object>[0],
      },
      defaultModel: { providerID: "dynamic", modelID: "test-model" },
    } as AgentRuntimeConfig

    const service = await makeProviderService(config)

    // 3. createModelAdapter 端到端走通：Config.getProvider → registry.resolve →
    //    resolveDynamicProvider → 占位包 → 工厂 → 返回 LanguageModel
    const adapter = await Effect.runPromise(
      service.createModelAdapter({
        providerID: "dynamic",
        modelID: "test-model",
      }),
    )

    expect(adapter).toBeDefined()
    expect(typeof adapter.stream).toBe("function")

    // 4. 占位工厂被精确调用（端到端到达了真正的 dynamic resolver）
    const factory = fixtures.pkgExports.createTestDynamicFixture as ReturnType<
      typeof vi.fn
    >
    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "test-key" }),
    )
  })

  // ── Case B: 白名单外的 npm 包 → fail-fast 在 Effect fail channel ────

  it("B. 白名单外包名 → service.createModelAdapter 在 Effect channel 失败", async () => {
    const config: AgentRuntimeConfig = {
      providers: {
        dynamic: {
          apiKey: "x",
          baseURL: undefined,
          // 关键：白名单外 —— 不匹配 ^@ai-sdk/[a-z0-9-]+$
          dynamicPackage: "evil-pkg",
          protocol: "openai-compatible",
          models: undefined,
          promptStyle: null,
        } as Parameters<typeof Object>[0],
      },
      defaultModel: { providerID: "dynamic", modelID: "any" },
    } as AgentRuntimeConfig

    const service = await makeProviderService(config)

    // Effect channel 失败：runPromiseExit 拿到 Failure，断言错误 message 包含
    // 白名单拦截标识（来自 DynamicProviderNotAllowedError）
    const exit = await Effect.runPromiseExit(
      service.createModelAdapter({
        providerID: "dynamic",
        modelID: "any",
      }),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    const cause = exit.cause
    // Effect 把 reject 的 Promise 包成 Cause；提取根因 message
    const causeStr = JSON.stringify(cause)
    expect(causeStr).toMatch(/not allowed|whitelist|@ai-sdk\//)
  })

  // ── Case C: 缺失 dynamicPackage 字段 → fail-fast ──────────────────

  it("C. providerID=dynamic 但缺 dynamicPackage → service.createModelAdapter 失败", async () => {
    const config: AgentRuntimeConfig = {
      providers: {
        dynamic: {
          apiKey: "x",
          baseURL: undefined,
          // dynamicPackage 故意缺失
          protocol: "openai-compatible",
          models: undefined,
          promptStyle: null,
        } as Parameters<typeof Object>[0],
      },
      defaultModel: { providerID: "dynamic", modelID: "any" },
    } as AgentRuntimeConfig

    const service = await makeProviderService(config)

    const exit = await Effect.runPromiseExit(
      service.createModelAdapter({
        providerID: "dynamic",
        modelID: "any",
      }),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    const causeStr = JSON.stringify(exit.cause)
    // 来自 DynamicProviderMissingPackageError
    expect(causeStr).toMatch(/dynamicPackage|missing|required/i)
  })
})
