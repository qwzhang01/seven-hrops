/* eslint-disable no-console */
/**
 * `runtime-multimodel-protocol-adapter` 阶段 6 自检脚本：ProviderRegistry 路由
 *
 * **不替代** 阶段 9 的正式 vitest 测试套件，是阶段 6 实施期的快速回归脚本——
 * 5 秒钟确认 registry 4 条路径都对齐 spec：
 *
 *   ① 19 个具名 plugin 全部能被解析（providerID + 无 config.protocol → 默认 protocol）
 *   ② volcengine（无 config.promptStyle） → adapter 是装饰器形态（doubao 默认开启）
 *   ③ volcengine（config.promptStyle = null）→ adapter 是裸 OpenAICompatibleProtocol（显式关闭）
 *   ④ 未知 providerID 缺 protocol → 抛 UnknownProviderProtocolError
 *
 * 不验证的部分（留给阶段 9）：
 *   - 真实 streamText 调用 SDK 实例
 *   - dynamic 路径完整流程（已由 check:dynamic-provider-safety 覆盖）
 *
 * 运行方式：`pnpm run check:registry-routing`
 */

import { defaultProviderRegistry } from "../src/agent-runtime/provider/registry"
import {
  BUILT_IN_PROVIDER_IDS,
  ProviderPlugins,
} from "../src/agent-runtime/provider/plugins/index"
import {
  OpenAICompatibleProtocol,
} from "../src/agent-runtime/provider/protocols/index"
import { UnknownProviderProtocolError } from "../src/agent-runtime/provider/_types"
import type { ProviderConfig } from "../src/agent-runtime/config/index"

let failures = 0
const ok = (label: string) => console.log(`✅ ${label}`)
const fail = (label: string, detail?: unknown) => {
  console.log(`❌ ${label}${detail !== undefined ? ` — ${String(detail)}` : ""}`)
  failures++
}

async function main() {
  // ── Case 1: 19 个具名 plugin 全部能解析 ─────────────────────────
  console.log("Case 1 — 19 个具名 provider 默认解析路径")
  for (const providerID of BUILT_IN_PROVIDER_IDS) {
    const config: ProviderConfig = {
      apiKey: "test-key",
    }
    try {
      const { sdkInstance, adapter } = await defaultProviderRegistry.resolve(
        providerID,
        config,
        "test-model",
      )
      const plugin = ProviderPlugins.find((p) => p.id === providerID)
      const expectedProtocol = plugin?.defaultProtocol
      if (sdkInstance === undefined || sdkInstance === null) {
        fail(`  ${providerID}: sdkInstance 为空`)
      } else if (adapter.protocolID !== expectedProtocol) {
        fail(
          `  ${providerID}: protocolID 期望 ${String(expectedProtocol)}，实际 ${String(adapter.protocolID)}`,
        )
      } else {
        ok(`  ${providerID} → protocol=${String(adapter.protocolID)}`)
      }
    } catch (e) {
      fail(`  ${providerID}: 抛错`, e)
    }
  }

  // ── Case 2: volcengine 默认 promptStyle="doubao" 启用装饰器 ─────
  console.log()
  console.log("Case 2 — volcengine 默认启用 doubao 装饰器")
  {
    const { adapter } = await defaultProviderRegistry.resolve(
      "volcengine",
      { apiKey: "test" },
      "doubao-1.5-pro",
    )
    // 装饰器形态的 adapter.protocolID 仍是 "openai-compatible"（装饰器透传 base 的 ID）
    // 但它**不**等于裸 OpenAICompatibleProtocol 引用——这是判断是否被装饰的关键
    if (adapter === OpenAICompatibleProtocol) {
      fail("  装饰器未生效，adapter 是裸 OpenAICompatibleProtocol")
    } else if (adapter.protocolID !== "openai-compatible") {
      fail(`  装饰器后的 protocolID 应仍为 openai-compatible，实际 ${String(adapter.protocolID)}`)
    } else {
      ok("  装饰器已挂载（adapter !== OpenAICompatibleProtocol）")
    }
  }

  // ── Case 3: volcengine + promptStyle: null → 显式关闭装饰器 ────
  console.log()
  console.log("Case 3 — promptStyle=null 显式关闭装饰器")
  {
    const { adapter } = await defaultProviderRegistry.resolve(
      "volcengine",
      { apiKey: "test", promptStyle: null },
      "doubao-1.5-pro",
    )
    if (adapter !== OpenAICompatibleProtocol) {
      fail("  promptStyle=null 时 adapter 应是裸 OpenAICompatibleProtocol，实际是装饰器形态")
    } else {
      ok("  adapter === OpenAICompatibleProtocol（裸）")
    }
  }

  // ── Case 4: openai + 用户覆盖 protocol → 用用户的值 ────────────
  console.log()
  console.log("Case 4 — config.protocol 覆盖 plugin.defaultProtocol")
  {
    const { adapter } = await defaultProviderRegistry.resolve(
      "openai",
      { apiKey: "test", protocol: "openai-compatible" },
      "gpt-4",
    )
    if (adapter.protocolID !== "openai-compatible") {
      fail(`  期望 openai-compatible（用户覆盖），实际 ${String(adapter.protocolID)}`)
    } else {
      ok("  config.protocol 覆盖生效")
    }
  }

  // ── Case 5: 未知 providerID 缺 protocol → fail-fast ────────────
  console.log()
  console.log("Case 5 — 未知 providerID 缺 protocol 抛 UnknownProviderProtocolError")
  try {
    await defaultProviderRegistry.resolve(
      "my-custom-llm",
      { apiKey: "test" },
      "model-a",
    )
    fail("  未抛错")
  } catch (e) {
    if (e instanceof UnknownProviderProtocolError) {
      // 错误消息应包含 providerID + 19 个已知 ID 提示
      const errStr = JSON.stringify(e)
      if (
        errStr.includes("my-custom-llm") &&
        errStr.includes("openai") &&
        errStr.includes("volcengine")
      ) {
        ok("  抛 UnknownProviderProtocolError，含 providerID 与 19 个已知 ID 列表")
      } else {
        fail(
          `  抛了 UnknownProviderProtocolError 但消息不全：${errStr.slice(0, 200)}`,
        )
      }
    } else {
      fail(`  抛了非预期错误`, e)
    }
  }

  // ── Case 6: 未知 providerID + 显式 protocol → 兜底走 OpenAI-Compatible ──
  console.log()
  console.log("Case 6 — 未知 providerID + 显式 protocol 兜底")
  try {
    const { sdkInstance, adapter } = await defaultProviderRegistry.resolve(
      "my-self-hosted-vllm",
      {
        apiKey: "test",
        baseURL: "http://localhost:8000/v1",
        protocol: "openai-compatible",
      },
      "qwen2.5-7b-instruct",
    )
    if (sdkInstance === undefined || sdkInstance === null) {
      fail("  兜底未返回 sdkInstance")
    } else if (adapter.protocolID !== "openai-compatible") {
      fail(`  protocolID 期望 openai-compatible，实际 ${String(adapter.protocolID)}`)
    } else {
      ok("  自托管 OpenAI-Compatible 兜底生效")
    }
  } catch (e) {
    fail("  兜底路径抛错", e)
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
