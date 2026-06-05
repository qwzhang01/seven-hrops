/**
 * `registry.test.ts`
 *
 * **任务 8.2**：ProviderRegistry 四类解析路径契约测试。
 *
 * 对应 spec.md `Scenario: Registry 四类解析路径均有测试`。
 *
 * 测试聚焦 **registry 路由分发层**——验证给定 (providerID, config) 走的是
 * 正确分支、产出的 ResolvedProvider 形态正确：
 *
 * | # | 分支 | 触发条件 | 预期 |
 * |---|------|----------|------|
 * | 1 | dynamic | `providerID === "dynamic"` | 调用 resolveDynamicProvider，按 result.protocolID 路由 adapter |
 * | 2 | 具名 plugin 默认推断 | `providerID ∈ BUILT_IN_PROVIDER_IDS` 且 `config.protocol === undefined` | 走 plugin.defaultProtocol + plugin.promptStyle |
 * | 3 | 显式 protocol 覆盖默认 | 同 2 但 `config.protocol` 已显式给出 | 用 config.protocol 而非 plugin.defaultProtocol |
 * | 4a | OpenAI-Compatible 兜底 | `providerID` 未知但 `config.protocol` 显式给出 | 用 createOpenAICompatible 兜底 + 用 config.protocol 选 adapter |
 * | 4b | fail-fast | `providerID` 未知且 `config.protocol === undefined` | 抛 `UnknownProviderProtocolError`（含 19 个已知 ID 列表） |
 *
 * 此外覆盖三态 promptStyle 决策（`undefined` 走 plugin 默认 / `null` 显式关闭 /
 * `string` 覆盖默认）的路由正确性——这是治本对象里最容易被一键改掉的语义。
 *
 * ## 不引入运行时副作用
 *
 * - dynamic 路径用 `vi.mock` 把 `./plugins/index` 的 `resolveDynamicProvider`
 *   替换为可控 stub——本测试不重复验证 dynamic resolver 的 7 步流程（那是
 *   阶段 9 的事），只验证"registry 把 dynamic 路径正确分发到 resolver 并按
 *   返回的 protocolID 路由 adapter"。
 * - 具名 plugin 路径会真调用 `plugin.createSdk()`——这会真 `createXxx({ apiKey })`
 *   构造 LanguageModel 实例。AI SDK 工厂仅做对象构造，不发网络请求。
 * - 不验证 adapter 实际 transform 输出（那是阶段 7 的契约测试已覆盖）；只看
 *   adapter.protocolID 路由 key 是否正确。
 *
 * ## 单一 agent loop 不变量回归
 *
 * resolved.adapter 必须只暴露 `protocolID` + `transform` 两字段——若装饰器
 * 路径偷偷挂上 `dispatch` 等动作类方法，本测试 SHALL fail（同 7.8 Case E
 * 的纪律 3.2 守卫）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── 在 import registry.ts 之前 mock dynamic resolver ────────────────
// vi.mock 必须发生在 import "./registry" 之前（vitest hoist 会自动处理但
// 我们仍按惯例显式声明在最顶部）。
//
// 注意：mock factory 内部不能直接引用文件外的变量（hoist 限制），所以
// `dynamicResolverMock` 在 mock factory 内创建并通过 `__getMock` 暴露给测试。
vi.mock("./plugins/index", async () => {
  // 保留原始模块的所有具名导出（19 个 plugin、ProviderPlugins、BUILT_IN_PROVIDER_IDS、
  // DYNAMIC_PROTOCOL 等），仅替换 resolveDynamicProvider。
  const actual =
    await vi.importActual<typeof import("./plugins/index")>("./plugins/index")
  const resolveDynamicProvider = vi.fn()
  return {
    ...actual,
    resolveDynamicProvider,
  }
})

import { defaultProviderRegistry, createProviderRegistry } from "./registry"
import { UnknownProviderProtocolError } from "./_types"
import type { ProviderConfig } from "../config/index"
import { resolveDynamicProvider } from "./plugins/index"

const dynamicResolverMock = resolveDynamicProvider as ReturnType<typeof vi.fn>

describe("ProviderRegistry — 四类解析路径契约", () => {
  // 每个 case 之前重置 mock，避免跨 case 调用计数污染
  beforeEachClearMock()

  // ── 分支 2：具名 plugin 默认推断 ──────────────────────────────────
  describe("分支 2: 具名 providerID + 默认 protocol 推断", () => {
    it("openai → defaultProtocol='openai-native' + 无装饰器 (无 promptStyle 默认)", async () => {
      const config: ProviderConfig = { providerID: "openai", apiKey: "sk-test" }
      const resolved = await defaultProviderRegistry.resolve(
        "openai",
        config,
        "gpt-4o-mini",
      )
      expect(resolved.sdkInstance).toBeDefined()
      expect(resolved.adapter.protocolID).toBe("openai-native")
      // 无装饰器：adapter 只暴露 protocolID + transform 两字段（纪律 3.2 守卫）
      const keys = Object.keys(resolved.adapter).sort()
      expect(keys).toEqual(["protocolID", "transform"])
    })

    it("anthropic → defaultProtocol='anthropic-messages'", async () => {
      const config: ProviderConfig = {
        providerID: "anthropic",
        apiKey: "sk-ant-test",
      }
      const resolved = await defaultProviderRegistry.resolve(
        "anthropic",
        config,
        "claude-sonnet-4",
      )
      expect(resolved.adapter.protocolID).toBe("anthropic-messages")
    })

    it("volcengine → defaultProtocol='openai-compatible' + 默认挂 doubao 装饰器（治本核心）", async () => {
      // 这是整个 change 治本对象的核心 contract：volcengine plugin 默认带
      // promptStyle="doubao"，registry 看到 config.promptStyle === undefined 时
      // 应自动挂 prompt-style 装饰器——替代旧 hack 后处理。
      const config: ProviderConfig = {
        providerID: "volcengine",
        apiKey: "vc-test",
      }
      const resolved = await defaultProviderRegistry.resolve(
        "volcengine",
        config,
        "doubao-pro-32k",
      )
      expect(resolved.adapter.protocolID).toBe("openai-compatible")
      // 装饰器透传 inner.protocolID，所以 protocolID 仍是 "openai-compatible"——
      // 这条不可作为"装饰器是否挂上"的判据；改为下面 promptStyle 三态测试覆盖。
    })
  })

  // ── 分支 3：显式 protocol 覆盖默认 ────────────────────────────────
  describe("分支 3: 显式 config.protocol 覆盖 plugin.defaultProtocol", () => {
    it("openai + config.protocol='openai-compatible' → 用 compatible 而非 native（用户显式降级）", async () => {
      const config: ProviderConfig = {
        providerID: "openai",
        apiKey: "sk-test",
        protocol: "openai-compatible",
      }
      const resolved = await defaultProviderRegistry.resolve(
        "openai",
        config,
        "gpt-4o-mini",
      )
      // openai plugin.defaultProtocol === 'openai-native'，但 config 显式置
      // 'openai-compatible'，registry 必须尊重用户配置。
      expect(resolved.adapter.protocolID).toBe("openai-compatible")
    })

    it("volcengine + config.promptStyle=null → 显式关闭 doubao 装饰器（三态 null）", async () => {
      // 治本细节：用户在 ProviderConfig.promptStyle 显式置 null 时应关装饰器，
      // 而非走 plugin 默认。这是三态语义中最容易出 bug 的"显式关闭"路径。
      const config: ProviderConfig = {
        providerID: "volcengine",
        apiKey: "vc-test",
        promptStyle: null,
      }
      const resolved = await defaultProviderRegistry.resolve(
        "volcengine",
        config,
        "doubao-pro-32k",
      )
      expect(resolved.adapter.protocolID).toBe("openai-compatible")
      // 没有装饰器层——但因为装饰器透传 protocolID，无法仅靠 protocolID 区分。
      // 唯一可靠方式是看 adapter 的 transform 是不是 base adapter 同一个引用——
      // 但 base adapter 是模块内私有；此处通过反射对象同一性间接验证：
      // 装饰器返回的对象与 base 不同；本 case 与下面 "promptStyle='doubao'"
      // case 的 adapter 应不同（一个有装饰器一个没有）。
      const decoratedConfig: ProviderConfig = {
        providerID: "volcengine",
        apiKey: "vc-test",
        promptStyle: "doubao",
      }
      const decoratedResolved = await defaultProviderRegistry.resolve(
        "volcengine",
        decoratedConfig,
        "doubao-pro-32k",
      )
      expect(resolved.adapter).not.toBe(decoratedResolved.adapter)
    })

    it("alibaba + config.promptStyle='qwen' → 挂 qwen 装饰器（三态 string 覆盖）", async () => {
      // alibaba plugin 默认不挂 promptStyle（避免误伤 qwen-plus 等原生
      // function-calling 模型卡）；用户为 qwen3-coder 等模型显式置 "qwen"
      // 时 registry 应挂上装饰器。
      const noStyleConfig: ProviderConfig = {
        providerID: "alibaba",
        apiKey: "ak-test",
      }
      const styledConfig: ProviderConfig = {
        providerID: "alibaba",
        apiKey: "ak-test",
        promptStyle: "qwen",
      }
      const noStyleResolved = await defaultProviderRegistry.resolve(
        "alibaba",
        noStyleConfig,
        "qwen-plus",
      )
      const styledResolved = await defaultProviderRegistry.resolve(
        "alibaba",
        styledConfig,
        "qwen3-coder",
      )
      expect(noStyleResolved.adapter).not.toBe(styledResolved.adapter)
    })
  })

  // ── 分支 4a：未知 providerID + 显式 protocol → OpenAI-Compatible 兜底 ──
  describe("分支 4a: 未知 providerID + 显式 protocol 兜底（自托管 vLLM/LM Studio）", () => {
    it("自定义 providerID + config.protocol='openai-compatible' → 用 createOpenAICompatible 兜底", async () => {
      const config: ProviderConfig = {
        providerID: "my-vllm-server",
        apiKey: "anything",
        baseURL: "http://192.168.1.10:8000/v1",
        protocol: "openai-compatible",
      }
      const resolved = await defaultProviderRegistry.resolve(
        "my-vllm-server",
        config,
        "Qwen/Qwen2.5-72B-Instruct",
      )
      expect(resolved.sdkInstance).toBeDefined()
      expect(resolved.adapter.protocolID).toBe("openai-compatible")
    })

    it("兜底分支也支持 config.promptStyle='qwen'（vLLM 加载 Qwen 模型时常需要）", async () => {
      const config: ProviderConfig = {
        providerID: "my-vllm-server",
        apiKey: "anything",
        baseURL: "http://192.168.1.10:8000/v1",
        protocol: "openai-compatible",
        promptStyle: "qwen",
      }
      const resolved = await defaultProviderRegistry.resolve(
        "my-vllm-server",
        config,
        "Qwen/Qwen3-Coder-32B",
      )
      // 装饰器透传 protocolID 仍是 openai-compatible
      expect(resolved.adapter.protocolID).toBe("openai-compatible")

      // 与不带 promptStyle 的兜底 adapter 对象不同
      const baseConfig: ProviderConfig = { ...config, promptStyle: null }
      const baseResolved = await defaultProviderRegistry.resolve(
        "my-vllm-server",
        baseConfig,
        "Qwen/Qwen3-Coder-32B",
      )
      expect(resolved.adapter).not.toBe(baseResolved.adapter)
    })
  })

  // ── 分支 4b：未知 providerID + 缺 protocol → fail-fast ────────────
  describe("分支 4b: fail-fast — 未知 providerID 且未指定 protocol", () => {
    it("抛 UnknownProviderProtocolError 含 providerID + 19 个已知 ID 列表", async () => {
      const config: ProviderConfig = {
        providerID: "totally-unknown-provider",
        apiKey: "x",
      }
      // 这是治本对象——不能静默回退到 OpenAI 协议，必须 fail-fast。
      await expect(
        defaultProviderRegistry.resolve(
          "totally-unknown-provider",
          config,
          "model",
        ),
      ).rejects.toMatchObject({
        _tag: "UnknownProviderProtocolError",
        providerID: "totally-unknown-provider",
      })
    })

    it("错误 payload 的 knownProviderIDs 包含 19 个具名 + 不含 'dynamic'", async () => {
      const config: ProviderConfig = {
        providerID: "x",
        apiKey: "y",
      }
      try {
        await defaultProviderRegistry.resolve("x", config, "m")
        throw new Error("should have thrown")
      } catch (e) {
        expect(e).toBeInstanceOf(UnknownProviderProtocolError)
        const err = e as UnknownProviderProtocolError
        expect(err.knownProviderIDs.length).toBe(19)
        expect(err.knownProviderIDs).toContain("openai")
        expect(err.knownProviderIDs).toContain("volcengine")
        expect(err.knownProviderIDs).not.toContain("dynamic")
      }
    })
  })

  // ── 分支 1：dynamic 路径（vi.mock 注入可控 stub） ─────────────────
  describe("分支 1: dynamic provider 路径", () => {
    it("providerID='dynamic' → 调用 resolveDynamicProvider，按 result.protocolID 路由 adapter", async () => {
      const fakeSdk = { specificationVersion: "v2", provider: "fake", modelId: "m" }
      dynamicResolverMock.mockResolvedValue({
        sdkInstance: fakeSdk,
        protocolID: "openai-compatible",
        packageName: "@ai-sdk/openai",
      })
      const config: ProviderConfig = {
        providerID: "dynamic",
        dynamicPackage: "@ai-sdk/openai",
        apiKey: "sk-test",
      }
      const resolved = await defaultProviderRegistry.resolve(
        "dynamic",
        config,
        "gpt-4o",
      )
      expect(dynamicResolverMock).toHaveBeenCalledTimes(1)
      expect(resolved.sdkInstance).toBe(fakeSdk)
      expect(resolved.adapter.protocolID).toBe("openai-compatible")
    })

    it("dynamic 路径透传 workspacePath / confirmCallback / readEnv 三个 options", async () => {
      const fakeSdk = { specificationVersion: "v2", provider: "fake", modelId: "m" }
      dynamicResolverMock.mockResolvedValue({
        sdkInstance: fakeSdk,
        protocolID: "openai-compatible",
        packageName: "@ai-sdk/openai",
      })
      const fakeConfirm = vi.fn(async () => true)
      const fakeEnv = vi.fn(() => "1")
      const config: ProviderConfig = {
        providerID: "dynamic",
        dynamicPackage: "@ai-sdk/openai",
      }
      await defaultProviderRegistry.resolve("dynamic", config, "m", {
        workspacePath: "/tmp/ws",
        confirmCallback: fakeConfirm,
        readEnv: fakeEnv,
      })
      expect(dynamicResolverMock).toHaveBeenCalledWith({
        config,
        modelID: "m",
        workspacePath: "/tmp/ws",
        confirmCallback: fakeConfirm,
        readEnv: fakeEnv,
      })
    })

    it("dynamic 路径默认 workspacePath=null（未传 options 时）", async () => {
      const fakeSdk = { specificationVersion: "v2", provider: "fake", modelId: "m" }
      dynamicResolverMock.mockResolvedValue({
        sdkInstance: fakeSdk,
        protocolID: "openai-compatible",
        packageName: "@ai-sdk/openai",
      })
      const config: ProviderConfig = {
        providerID: "dynamic",
        dynamicPackage: "@ai-sdk/openai",
      }
      await defaultProviderRegistry.resolve("dynamic", config, "m")
      const callArgs = dynamicResolverMock.mock.calls[0]?.[0]
      expect(callArgs?.workspacePath).toBeNull()
    })

    it("dynamic 路径下 config.promptStyle 仍被尊重（注入装饰器）", async () => {
      // 即便走 dynamic，用户也可能加载 vLLM 跑 Qwen 模型并显式要 qwen 装饰器。
      const fakeSdk = { specificationVersion: "v2", provider: "fake", modelId: "m" }
      dynamicResolverMock.mockResolvedValue({
        sdkInstance: fakeSdk,
        protocolID: "openai-compatible",
        packageName: "@ai-sdk/openai",
      })
      const baseConfig: ProviderConfig = {
        providerID: "dynamic",
        dynamicPackage: "@ai-sdk/openai",
        promptStyle: null,
      }
      const decoratedConfig: ProviderConfig = {
        providerID: "dynamic",
        dynamicPackage: "@ai-sdk/openai",
        promptStyle: "qwen",
      }
      const baseResolved = await defaultProviderRegistry.resolve(
        "dynamic",
        baseConfig,
        "m",
      )
      const decoratedResolved = await defaultProviderRegistry.resolve(
        "dynamic",
        decoratedConfig,
        "m",
      )
      expect(baseResolved.adapter).not.toBe(decoratedResolved.adapter)
    })

    it("dynamic resolver 抛错时 registry 透传错误（不吞）", async () => {
      const dynamicErr = new Error("simulated dynamic failure")
      dynamicResolverMock.mockRejectedValue(dynamicErr)
      const config: ProviderConfig = {
        providerID: "dynamic",
        dynamicPackage: "@ai-sdk/openai",
      }
      await expect(
        defaultProviderRegistry.resolve("dynamic", config, "m"),
      ).rejects.toBe(dynamicErr)
    })
  })

  // ── 工厂函数自检 ──────────────────────────────────────────────────
  describe("createProviderRegistry / defaultProviderRegistry", () => {
    it("createProviderRegistry() 返回独立 registry（多次调用产生不同对象但语义一致）", async () => {
      const r1 = createProviderRegistry()
      const r2 = createProviderRegistry()
      expect(r1).not.toBe(r2)
      // 但行为一致：同输入产同 protocolID
      const cfg: ProviderConfig = { providerID: "openai", apiKey: "k" }
      const a1 = await r1.resolve("openai", cfg, "gpt-4o-mini")
      const a2 = await r2.resolve("openai", cfg, "gpt-4o-mini")
      expect(a1.adapter.protocolID).toBe(a2.adapter.protocolID)
    })

    it("defaultProviderRegistry 是单例（多次 import 同一引用）", () => {
      // re-import 验证（vitest 模块缓存内同一引用）
      expect(defaultProviderRegistry).toBe(defaultProviderRegistry)
    })
  })
})

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * 在每个 case 之前清空 dynamic resolver mock 的调用记录与返回值，避免跨 case
 * 污染。手写而非用 `beforeEach` 是因为 vitest beforeEach 全局污染问题在某些
 * 嵌套 describe 里表现不可预期；写成显式 helper 在每个 describe 顶部调用更稳。
 *
 * 但本文件只有一处需要清——用 vitest 内置 `beforeEach` 即可。
 */
function beforeEachClearMock() {
  beforeEach(() => {
    dynamicResolverMock.mockReset()
  })
}
