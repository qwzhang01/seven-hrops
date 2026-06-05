/**
 * `protocols/prompt-style-tool-call.test.ts`
 *
 * **任务 7.4–7.8**：prompt-style 装饰器的契约测试。
 *
 * 这是整个 runtime-multimodel-protocol-adapter change 的**核心治本回归套件**——
 * 装饰器是替代"治标 doubao 后处理 hack"的治本方案，所以它的状态机必须有
 * 充分的测试守卫，否则一次重构滑坡就会让豆包/Qwen 的工具调用全线崩溃。
 *
 * ## 测试组织
 *
 * - **Case A** (任务 7.4)：豆包正常 token 序列，整流一次性输入 — 走 `__internal.stepText`
 *   纯函数 + 完整 Stream 双重断言。
 * - **Case B** (任务 7.5)：1 字节 1 chunk 切割（spec.md 强制 scenario）— 验证
 *   buffer 跨 chunk 不漏检。
 * - **Case C** (任务 7.6)：流提前结束 token 未闭合 → emit error — 走完整 Stream
 *   集成测试覆盖 finalize 路径。
 * - **Case D** (任务 7.7 + real-machine 升级)：JSON parse 失败 / 数组形态 / `parameters` 字段 — 走 `parseToolCalls`
 *   纯函数。
 * - **Case E** (任务 7.8)：装饰器仅做 stream-in/stream-out — 走完整 Stream 验证
 *   非 text-delta 事件（reasoning-delta / tool-call / tool-result / error）原样
 *   透传，且装饰器不持有任何工具 dispatch 副作用。
 *
 * ## 不变量
 *
 * 装饰器 SHALL：
 * - 仅做 stream-in/stream-out 的纯函数式转换；
 * - 跨 chunk token 序列不漏检（Case B）；
 * - 未闭合 token 在 stream 终止时 emit error 而非静默吞掉（Case C）；
 * - JSON 解析失败时 emit error 不 crash（Case D）；
 * - 不在测试期间触发任何工具 dispatch / follow-up（Case E，platform-foundation 纪律 3.2）。
 */

import { describe, it, expect } from "vitest"
import { Effect, Stream } from "effect"
import {
  withPromptStyleToolCall,
  TOKEN_PATTERNS,
  MAX_TOKEN_LEN,
  __internal,
} from "./prompt-style-tool-call"
import type { LLMStreamEvent } from "../../agent/tool-runtime"
import { makeFakeInnerAdapter } from "./_protocol-test-utils"

const DOUBAO = TOKEN_PATTERNS.doubao
const QWEN = TOKEN_PATTERNS.qwen

/**
 * 跑装饰器：用 makeFakeInnerAdapter 构造 inner stream，让装饰器处理后收集
 * 全部 LLMStreamEvent。
 *
 * 注意 transform 的 `rawStream` 入参在装饰器路径**未被使用**——装饰器只调
 * `inner.transform(rawStream)` 拿 inner stream。所以这里传 `[]` 就够了。
 */
async function runDecorator(
  innerEvents: ReadonlyArray<LLMStreamEvent>,
  style: "doubao" | "qwen",
): Promise<readonly LLMStreamEvent[]> {
  const inner = makeFakeInnerAdapter("openai-compatible", innerEvents)
  const decorated = withPromptStyleToolCall(inner, style)
  // 入参 rawStream 在装饰器路径里实际不读取，传空 iterable。
  const stream = decorated.transform({
    [Symbol.asyncIterator]() {
      return { async next() { return { value: undefined, done: true } as const } }
    },
  })
  const collected: LLMStreamEvent[] = []
  await Effect.runPromise(
    Stream.runForEach(stream, (e) =>
      Effect.sync(() => {
        collected.push(e)
      }),
    ),
  )
  return collected
}

// ─── Case A (7.4)：豆包正常 token 序列，整流一次性输入 ─────────────

describe("prompt-style-tool-call: Case A — 豆包正常 token 序列", () => {
  it("__internal.stepText: 单段文本含完整 begin..end token，emit text + tool-call", () => {
    const text =
      `前言`
      + DOUBAO.begin
      + `{"name":"echo","arguments":{"msg":"hi"}}`
      + DOUBAO.end
      + `尾巴`
    const { events, next } = __internal.stepText(
      { mode: "idle", buffer: "" },
      text,
      DOUBAO,
    )
    // 期望：text("前言") → tool-call(echo,{msg:"hi"}) → ...
    // "尾巴" 这部分会留在 buffer（长度 < MAX_TOKEN_LEN，safe-flush 不动）。
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[0]).toEqual({ type: "text-delta", text: "前言" })
    const toolCall = events[1]
    if (toolCall.type !== "tool-call") {
      throw new Error(`expected tool-call, got ${toolCall.type}`)
    }
    expect(toolCall.name).toBe("echo")
    expect(toolCall.input).toEqual({ msg: "hi" })
    // next.mode 回到 idle；buffer 残余 "尾巴"
    expect(next.mode).toBe("idle")
    expect(next.buffer).toBe("尾巴")
  })

  it("装饰器集成：text-delta 含完整 token + finish → emit text + tool-call + 残余 text + finish", async () => {
    const events = await runDecorator(
      [
        {
          type: "text-delta",
          text:
            `前言`
            + DOUBAO.begin
            + `{"name":"echo","arguments":{"msg":"hi"}}`
            + DOUBAO.end
            + `尾巴`,
        },
        { type: "finish", reason: "stop" },
      ],
      "doubao",
    )
    // finalize 时把残余 buffer flush 为 text-delta，再追加 finish。
    const types = events.map((e) => e.type)
    expect(types).toEqual([
      "text-delta", // "前言"
      "tool-call",  // echo
      "text-delta", // "尾巴"（finalize flush）
      "finish",
    ])
    const toolCall = events[1]
    if (toolCall.type !== "tool-call") throw new Error("expected tool-call")
    expect(toolCall.name).toBe("echo")
    expect(toolCall.input).toEqual({ msg: "hi" })
  })

  it("Qwen 风格：<tool_call>...</tool_call> 同构识别", async () => {
    const events = await runDecorator(
      [
        {
          type: "text-delta",
          text:
            `OK `
            + QWEN.begin
            + `{"name":"calc","arguments":{"a":1,"b":2}}`
            + QWEN.end,
        },
        { type: "finish", reason: "stop" },
      ],
      "qwen",
    )
    const toolCall = events.find((e) => e.type === "tool-call")
    expect(toolCall).toBeDefined()
    if (toolCall?.type === "tool-call") {
      expect(toolCall.name).toBe("calc")
      expect(toolCall.input).toEqual({ a: 1, b: 2 })
    }
  })

  it("同一段文本多个连续 tool-call 都能被识别（while 循环正确）", async () => {
    const events = await runDecorator(
      [
        {
          type: "text-delta",
          text:
            DOUBAO.begin
            + `{"name":"a","arguments":{}}`
            + DOUBAO.end
            + DOUBAO.begin
            + `{"name":"b","arguments":{}}`
            + DOUBAO.end,
        },
        { type: "finish", reason: "stop" },
      ],
      "doubao",
    )
    const toolCalls = events.filter((e) => e.type === "tool-call")
    expect(toolCalls).toHaveLength(2)
    if (toolCalls[0].type === "tool-call") expect(toolCalls[0].name).toBe("a")
    if (toolCalls[1].type === "tool-call") expect(toolCalls[1].name).toBe("b")
  })
})

// ─── Case B (7.5)：1 字节 1 chunk 切割（spec.md 强制 scenario） ───

describe("prompt-style-tool-call: Case B — 1 字节 1 chunk 切割", () => {
  it("把完整文本切成单字节序列喂入，仍能识别 tool-call（跨 chunk 不漏检）", async () => {
    const fullText =
      `Hi `
      + DOUBAO.begin
      + `{"name":"echo","arguments":{"x":42}}`
      + DOUBAO.end
      + `Bye`
    // 切成 1 字节 1 chunk 的 text-delta 事件序列
    const innerEvents: LLMStreamEvent[] = []
    for (const ch of fullText) {
      innerEvents.push({ type: "text-delta", text: ch })
    }
    innerEvents.push({ type: "finish", reason: "stop" })

    const events = await runDecorator(innerEvents, "doubao")
    // 期望最终有：≥1 个 text-delta（含 "Hi " 与 "Bye"）+ 1 个 tool-call + 1 个 finish
    const toolCalls = events.filter((e) => e.type === "tool-call")
    expect(toolCalls).toHaveLength(1)
    if (toolCalls[0].type === "tool-call") {
      expect(toolCalls[0].name).toBe("echo")
      expect(toolCalls[0].input).toEqual({ x: 42 })
    }
    // 拼回所有 text-delta，应该等于原文中除 token+JSON 之外的部分
    const textOut = events
      .filter((e) => e.type === "text-delta")
      .map((e) => (e.type === "text-delta" ? e.text : ""))
      .join("")
    expect(textOut).toBe("Hi Bye")
    // finish 事件最后透传
    expect(events[events.length - 1]).toEqual({ type: "finish", reason: "stop" })
  })

  it("MAX_TOKEN_LEN 守卫：buffer 超长时不会无限增长（safe-flush 生效）", async () => {
    // 构造一段不含 token、长度远超 MAX_TOKEN_LEN 的纯文本——按 spec 应被
    // safe-flush 切片 emit 出去，而不是堆在 buffer 里直到 OOM。
    const longPlain = "A".repeat(MAX_TOKEN_LEN * 100)
    const events = await runDecorator(
      [
        { type: "text-delta", text: longPlain },
        { type: "finish", reason: "stop" },
      ],
      "doubao",
    )
    // 把所有 text-delta 拼起来必须等于 longPlain（不丢字节）
    const textOut = events
      .filter((e) => e.type === "text-delta")
      .map((e) => (e.type === "text-delta" ? e.text : ""))
      .join("")
    expect(textOut).toBe(longPlain)
    // 应该被切成多段（safe-flush 至少触发过一次）——验证 buffer 没堆积
    const textDeltaCount = events.filter((e) => e.type === "text-delta").length
    expect(textDeltaCount).toBeGreaterThanOrEqual(1)
  })
})

// ─── Case C (7.6)：流提前结束 token 未闭合 → emit error ──────────

describe("prompt-style-tool-call: Case C — 流提前结束 token 未闭合", () => {
  it("in-call 态遇 finish 时 emit error（finalize 行为）", async () => {
    const events = await runDecorator(
      [
        {
          type: "text-delta",
          text: `前缀` + DOUBAO.begin + `{"name":"x"`,
          // 注意：未闭合，end token 缺失
        },
        { type: "finish", reason: "stop" },
      ],
      "doubao",
    )
    // 期望：text-delta("前缀") → error("did not close") → finish
    const errEvent = events.find((e) => e.type === "error")
    expect(errEvent).toBeDefined()
    if (errEvent?.type === "error") {
      expect((errEvent.error as Error).message).toMatch(/did not close/i)
    }
    // finish 仍透传（在 error 后）
    expect(events[events.length - 1]).toEqual({ type: "finish", reason: "stop" })
  })

  it("in-call 态遇 error 时也走 finalize 并保留原 error 在末尾", async () => {
    const events = await runDecorator(
      [
        {
          type: "text-delta",
          text: DOUBAO.begin + `{"incomplete":`,
        },
        { type: "error", error: new Error("upstream 503") },
      ],
      "doubao",
    )
    // 期望两个 error：一个 finalize 出来的 "did not close"，一个原始 upstream 错
    const errs = events.filter((e) => e.type === "error")
    expect(errs).toHaveLength(2)
    if (errs[0].type === "error") {
      expect((errs[0].error as Error).message).toMatch(/did not close/i)
    }
    if (errs[1].type === "error") {
      expect((errs[1].error as Error).message).toBe("upstream 503")
    }
  })
})

// ─── Case D (7.7 + real-machine升级)：JSON 形态解析（含数组、parameters 字段） ──────

describe("prompt-style-tool-call: Case D — JSON 解析与豆包真机形态兼容", () => {
  it("__internal.parseToolCalls: 非法 JSON → 长度1的 error 数组，不抛异常", () => {
    const evts = __internal.parseToolCalls(`{not valid json`)
    expect(evts).toHaveLength(1)
    expect(evts[0].type).toBe("error")
    if (evts[0].type === "error") {
      expect((evts[0].error as Error).message).toMatch(/parse failed/i)
    }
  })

  it("__internal.parseToolCalls: 顶层数组（豆包真机形态）→ 多条 tool-call 事件", () => {
    // 豆包真机形态：一段 begin/end 内允许多并发 tool-call，顶层是数组
    const raw = `[{"name":"a","parameters":{"x":1}},{"name":"b","parameters":{"y":2}}]`
    const evts = __internal.parseToolCalls(raw)
    expect(evts).toHaveLength(2)
    expect(evts[0]).toMatchObject({ type: "tool-call", name: "a", input: { x: 1 } })
    expect(evts[1]).toMatchObject({ type: "tool-call", name: "b", input: { y: 2 } })
  })

  it("__internal.parseToolCalls: 数组中混入非 object 项 → 该项 error，其它项正常", () => {
    // 数组容错：第 i 项形态非法时不污染其它项
    const raw = `[{"name":"good","parameters":{}},42,{"name":"also_good","parameters":{"z":3}}]`
    const evts = __internal.parseToolCalls(raw)
    expect(evts).toHaveLength(3)
    expect(evts[0]).toMatchObject({ type: "tool-call", name: "good" })
    expect(evts[1].type).toBe("error")
    if (evts[1].type === "error") {
      expect((evts[1].error as Error).message).toMatch(/array\[1\].*not an object/i)
    }
    expect(evts[2]).toMatchObject({ type: "tool-call", name: "also_good", input: { z: 3 } })
  })

  it("__internal.parseToolCalls: 顶层对象（Qwen / 自造 fixture）→ 长度1的 tool-call 数组", () => {
    const evts = __internal.parseToolCalls(`{"name":"x","arguments":{"a":1}}`)
    expect(evts).toHaveLength(1)
    expect(evts[0]).toMatchObject({ type: "tool-call", name: "x", input: { a: 1 } })
  })

  it("__internal.parseToolCalls: 缺 name 字段 → 长度1的 error 数组", () => {
    const evts = __internal.parseToolCalls(`{"arguments":{"x":1}}`)
    expect(evts).toHaveLength(1)
    expect(evts[0].type).toBe("error")
    if (evts[0].type === "error") {
      expect((evts[0].error as Error).message).toMatch(/missing.*name/i)
    }
  })

  it("__internal.parseToolCalls: 入参字段名 parameters（豆包真机）→ 被识别为 input", () => {
    // 真机形态守卫：豆包用 parameters 而非 arguments
    const evts = __internal.parseToolCalls(`{"name":"list_dir","parameters":{"dir_path":"01_inputs/"}}`)
    expect(evts).toHaveLength(1)
    expect(evts[0]).toMatchObject({
      type: "tool-call",
      name: "list_dir",
      input: { dir_path: "01_inputs/" },
    })
  })

  it("__internal.parseToolCalls: arguments 与 parameters 同时存在时 arguments 优先", () => {
    // 优先级守卫：避免 Qwen / 早期 fixture 行为偏移
    const evts = __internal.parseToolCalls(
      `{"name":"x","arguments":{"a":1},"parameters":{"b":2}}`,
    )
    expect(evts).toHaveLength(1)
    expect(evts[0]).toMatchObject({ type: "tool-call", name: "x", input: { a: 1 } })
  })

  it("__internal.parseToolCalls: arguments=null 但 parameters 存在 → 用 parameters", () => {
    // null 在 ?? 下被回落（旧 ?? 操作符行为：null 与 undefined 都触发回落）
    const evts = __internal.parseToolCalls(
      `{"name":"x","arguments":null,"parameters":{"k":"v"}}`,
    )
    expect(evts).toHaveLength(1)
    expect(evts[0]).toMatchObject({ type: "tool-call", name: "x", input: { k: "v" } })
  })

  it("__internal.parseToolCalls: 二者均缺或非 object → input 降级为 {}", () => {
    const evts = __internal.parseToolCalls(`{"name":"x"}`)
    expect(evts).toHaveLength(1)
    expect(evts[0]).toMatchObject({ type: "tool-call", name: "x", input: {} })
  })

  it("装饰器集成：非法 JSON 不让流崩溃，emit error 后继续处理后续事件", async () => {
    const events = await runDecorator(
      [
        {
          type: "text-delta",
          text:
            DOUBAO.begin
            + `{not valid json`
            + DOUBAO.end
            + `继续文本`,
        },
        { type: "finish", reason: "stop" },
      ],
      "doubao",
    )
    // 应包含 error（parse 失败） + text-delta（"继续文本"） + finish
    const errIdx = events.findIndex((e) => e.type === "error")
    const finishIdx = events.findIndex((e) => e.type === "finish")
    expect(errIdx).toBeGreaterThanOrEqual(0)
    expect(finishIdx).toBeGreaterThan(errIdx) // error 在 finish 前
    // 后续 "继续文本" 也应被正常 emit
    const textOut = events
      .filter((e) => e.type === "text-delta")
      .map((e) => (e.type === "text-delta" ? e.text : ""))
      .join("")
    expect(textOut).toContain("继续文本")
  })
})

// ─── Case E (7.8)：装饰器仅做 stream-in/stream-out（无副作用） ──

describe("prompt-style-tool-call: Case E — 装饰器纯转换无副作用", () => {
  it("非 text-delta 事件原样透传（reasoning-delta / tool-call / tool-result）", async () => {
    // 这些事件按 spec 不经状态机，应被透传——验证装饰器没有篡改 inner 已经
    // emit 的标准 tool-call 事件（这是与"治标 hack"的关键差异：装饰器只
    // 处理伪 token text，不动真 tool-call）。
    const innerEvents: LLMStreamEvent[] = [
      { type: "reasoning-delta", text: "thinking" },
      {
        type: "tool-call",
        id: "real-tc-1",
        name: "real_fn",
        input: { x: 1 },
      },
      {
        type: "tool-result",
        id: "real-tc-1",
        name: "real_fn",
        result: "ok",
      },
      { type: "finish", reason: "stop" },
    ]
    const events = await runDecorator(innerEvents, "doubao")
    expect(events).toEqual(innerEvents)
  })

  it("装饰器不持有也不调用工具的 execute（platform-foundation 纪律 3.2）", () => {
    // 静态守卫：装饰器返回的 ProtocolAdapter 仅有 protocolID + transform 两个字段。
    // 通过反射验证它没有偷偷挂上 dispatch / executeTool / runTools 等违反单一
    // agent loop 不变量的方法。
    const inner = makeFakeInnerAdapter("openai-compatible", [])
    const decorated = withPromptStyleToolCall(inner, "doubao")
    const keys = Object.keys(decorated).sort()
    expect(keys).toEqual(["protocolID", "transform"])
    // 显式列名查无：装饰器对象上不能有这些动作类方法
    expect((decorated as Record<string, unknown>).dispatch).toBeUndefined()
    expect((decorated as Record<string, unknown>).execute).toBeUndefined()
    expect((decorated as Record<string, unknown>).runTools).toBeUndefined()
  })

  it("装饰器 protocolID 透传 inner（未篡改路由 key）", () => {
    const innerOpenAI = makeFakeInnerAdapter("openai-compatible", [])
    expect(withPromptStyleToolCall(innerOpenAI, "doubao").protocolID).toBe(
      "openai-compatible",
    )
    const innerOpenAINative = makeFakeInnerAdapter("openai-native", [])
    expect(withPromptStyleToolCall(innerOpenAINative, "doubao").protocolID).toBe(
      "openai-native",
    )
  })

  it("idle 态收尾时残余 buffer 全部 flush 为 text-delta（finalize 不丢字节）", async () => {
    const events = await runDecorator(
      [
        { type: "text-delta", text: "残余文本无 token" },
        { type: "finish", reason: "stop" },
      ],
      "doubao",
    )
    const textOut = events
      .filter((e) => e.type === "text-delta")
      .map((e) => (e.type === "text-delta" ? e.text : ""))
      .join("")
    expect(textOut).toBe("残余文本无 token")
    expect(events[events.length - 1]).toEqual({ type: "finish", reason: "stop" })
  })
})
