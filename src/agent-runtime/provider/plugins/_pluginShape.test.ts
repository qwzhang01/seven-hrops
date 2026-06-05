/**
 * `plugins/_pluginShape.test.ts`
 *
 * **任务 8.1**：ProviderPlugin 形态契约测试。
 *
 * 这是一组**面向数组**的契约测试——把 [`ProviderPlugins`](./index.ts) 数组当
 * 不变量本身来守卫，而不是单独测某个 plugin 的字段值。19 个具名 plugin 的
 * 共有结构纪律集中在这里强校验：
 *
 * | 不变量 | 守卫断言 |
 * |--------|----------|
 * | 长度对齐 | `ProviderPlugins.length === BUILT_IN_PROVIDER_IDS.length` |
 * | 顺序对齐 | 每个位置 `plugin.id === BUILT_IN_PROVIDER_IDS[i]`（plugin 数组与 ID 名册必须同步） |
 * | ID 唯一  | 19 个 plugin 的 id 之间互不重复 |
 * | 形态完整 | 每个 plugin 含 id / defaultProtocol / defaultBaseURL / createSdk 四字段非空 |
 * | 协议合法 | 每个 plugin 的 defaultProtocol ∈ ProtocolID 联合（"openai-native" / "openai-compatible" / "anthropic-messages"） |
 * | promptStyle 合法 | 若声明了 promptStyle，则 ∈ PromptStyleID 联合（"doubao" / "qwen"） |
 * | createSdk 是函数 | typeof === "function" 且 arity 为 1（接受 options 对象） |
 *
 * 此外有几条**回归守卫**针对历史 bug：
 *
 * - `volcengine` plugin 的 `promptStyle` 必须是 `"doubao"`（spec.md 治本对象，
 *   平替原 hack 后处理）。任何 PR 不小心把这条改掉时此测试 SHALL fail。
 * - `anthropic` plugin 的 `defaultProtocol` 必须是 `"anthropic-messages"`，
 *   不能错配为 `"openai-compatible"`。
 * - `openai` plugin 的 `defaultProtocol` 必须是 `"openai-native"`（含 reasoning-delta），
 *   不能降级为 `"openai-compatible"`（会丢失 reasoning 流）。
 *
 * ## 不引入运行时副作用
 *
 * 本测试仅断言**类型层 + 元数据层**——不调用 `plugin.createSdk()`（那会真的
 * import SDK npm 包），不发任何网络请求；测试在毫秒级完成。
 */

import { describe, it, expect } from "vitest"
import {
  ProviderPlugins,
  BUILT_IN_PROVIDER_IDS,
  type ProviderPlugin,
  type BuiltInProviderID,
} from "./index"

// 合法的 ProtocolID 字面量集合（与 _types.ts 的 ProtocolID 联合手工保持同步——
// 这本身就是测试的一部分：若 _types.ts 联合扩展而此处未扩展，下方循环里某个
// plugin 用了新协议时 expect 会落到 fail 路径）。
const VALID_PROTOCOL_IDS: ReadonlyArray<string> = [
  "openai-native",
  "openai-compatible",
  "anthropic-messages",
] as const

const VALID_PROMPT_STYLE_IDS: ReadonlyArray<string> = ["doubao", "qwen"] as const

describe("ProviderPlugins 数组契约（_pluginShape.test.ts）", () => {
  it("长度对齐 BUILT_IN_PROVIDER_IDS（19 个）", () => {
    expect(ProviderPlugins.length).toBe(BUILT_IN_PROVIDER_IDS.length)
    expect(ProviderPlugins.length).toBe(19)
  })

  it("顺序对齐：每个位置 plugin.id === BUILT_IN_PROVIDER_IDS[i]", () => {
    BUILT_IN_PROVIDER_IDS.forEach((expectedID, i) => {
      const plugin = ProviderPlugins[i]
      expect(plugin).toBeDefined()
      expect(plugin!.id).toBe(expectedID)
    })
  })

  it("ID 唯一：19 个 plugin id 互不重复", () => {
    const ids = ProviderPlugins.map((p) => p.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  // ── 遍历每个 plugin 强校验形态 ──────────────────────────────────
  // 用 describe.each 让每个 plugin 一个独立 sub-describe，失败时报错信息
  // 直接显示是哪个 plugin 不合规，便于定位。
  describe.each(ProviderPlugins.map((p) => [p.id, p] as const))(
    "plugin[%s] 形态",
    (id, plugin: ProviderPlugin) => {
      it("id 非空且为 string", () => {
        expect(typeof plugin.id).toBe("string")
        expect(plugin.id.length).toBeGreaterThan(0)
        expect(plugin.id).toBe(id) // 闭环验证
      })

      it("defaultProtocol ∈ ProtocolID 联合", () => {
        expect(VALID_PROTOCOL_IDS).toContain(plugin.defaultProtocol)
      })

      it("defaultBaseURL 非空 string 且形态像 URL（http/https）", () => {
        expect(typeof plugin.defaultBaseURL).toBe("string")
        expect(plugin.defaultBaseURL.length).toBeGreaterThan(0)
        // 不强求严格 URL 解析（ollama 是 http://localhost:11434），但要求带协议
        expect(plugin.defaultBaseURL).toMatch(/^https?:\/\//)
      })

      it("createSdk 是 function（arity 为 1）", () => {
        expect(typeof plugin.createSdk).toBe("function")
        // SDK 工厂签名为 (options) => unknown，arity = 1
        expect(plugin.createSdk.length).toBe(1)
      })

      it("promptStyle 若存在则 ∈ PromptStyleID 联合", () => {
        if (plugin.promptStyle !== undefined) {
          expect(VALID_PROMPT_STYLE_IDS).toContain(plugin.promptStyle)
        }
      })
    },
  )

  // ── 回归守卫：针对 spec.md 治本对象与历史 bug ────────────────────
  describe("回归守卫", () => {
    it("volcengine plugin.promptStyle === 'doubao'（治本核心：spec.md 治本对象）", () => {
      const volc = ProviderPlugins.find((p) => p.id === "volcengine")
      expect(volc).toBeDefined()
      expect(volc!.promptStyle).toBe("doubao")
    })

    it("alibaba plugin.promptStyle 默认 undefined（避免误伤 qwen-plus/qwen-turbo 等原生 function-calling 模型卡；用户在 ProviderConfig.promptStyle 显式置 'qwen' 时由 registry 挂装饰器）", () => {
      const alibaba = ProviderPlugins.find((p) => p.id === "alibaba")
      expect(alibaba).toBeDefined()
      expect(alibaba!.promptStyle).toBeUndefined()
    })

    it("仅 volcengine 在 plugin 层默认挂 promptStyle（豆包必带 doubao 编码 → 治本必须默认）", () => {
      // 19 个 plugin 中只有 volcengine 默认挂 promptStyle。其余厂商要么走原生
      // function-calling、要么由用户按模型卡显式声明（如 alibaba qwen3-coder）。
      // 这条不变量是 prompt-style 装饰器"默认安全"原则的核心——它保证未来某次
      // 重构若把 doubao 之外的 promptStyle 也变成默认，会被这条立刻拦下。
      const withPromptStyle = ProviderPlugins.filter(
        (p) => p.promptStyle !== undefined,
      )
      expect(withPromptStyle).toHaveLength(1)
      expect(withPromptStyle[0]!.id).toBe("volcengine")
      expect(withPromptStyle[0]!.promptStyle).toBe("doubao")
    })

    it("openai plugin.defaultProtocol === 'openai-native'（保留 reasoning-delta）", () => {
      const openai = ProviderPlugins.find((p) => p.id === "openai")
      expect(openai).toBeDefined()
      expect(openai!.defaultProtocol).toBe("openai-native")
    })

    it("anthropic plugin.defaultProtocol === 'anthropic-messages'", () => {
      const anthropic = ProviderPlugins.find((p) => p.id === "anthropic")
      expect(anthropic).toBeDefined()
      expect(anthropic!.defaultProtocol).toBe("anthropic-messages")
    })

    it("国产兼容族 plugin.defaultProtocol 全部 === 'openai-compatible'", () => {
      // 这些 provider 都通过 createOpenAICompatible 桥接，必须用 compatible 协议。
      const compatibleFamily: ReadonlyArray<BuiltInProviderID> = [
        "volcengine",
        "deepseek",
        "zhipu",
        "moonshot",
        "lingyiwanwu",
        "hunyuan",
        "alibaba",
      ]
      compatibleFamily.forEach((targetID) => {
        const p = ProviderPlugins.find((x) => x.id === targetID)
        expect(p).toBeDefined()
        expect(p!.defaultProtocol).toBe("openai-compatible")
      })
    })

    it("BUILT_IN_PROVIDER_IDS 不含 'dynamic'（dynamic 走独立分支）", () => {
      // dynamic resolver 不是 ProviderPlugin，不进入 ProviderPlugins[]——
      // BUILT_IN_PROVIDER_IDS 也只列具名 19 个。
      expect(BUILT_IN_PROVIDER_IDS).not.toContain("dynamic")
    })
  })
})
