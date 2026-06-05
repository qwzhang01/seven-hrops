/**
 * Provider 协议适配层 — 测试共享工具（`protocols/_protocol-test-utils.ts`）
 *
 * 给 [`openai-native.test.ts`](./openai-native.test.ts)、
 * [`openai-compatible.test.ts`](./openai-compatible.test.ts)、
 * [`anthropic-messages.test.ts`](./anthropic-messages.test.ts)、
 * [`prompt-style-tool-call.test.ts`](./prompt-style-tool-call.test.ts) 共用
 * 的两个测试 helper：
 *
 * 1. `mockTextStreamPartIterable(parts)` — 把 `TextStreamPart` 数组包成
 *    AsyncIterable（adapter.transform 入参形态）。
 * 2. `collectAdapterEvents(adapter, parts)` — 让 adapter 跑完，把 `LLMStreamEvent`
 *    流收集为数组，便于 vitest `toEqual` 断言全序列。
 *
 * 这两个 helper 让协议层测试聚焦于"输入 stream-part 序列 → 输出 stream-event
 * 序列"的纯函数行为，不需要每个测试自己手写 Effect Stream / AsyncIterable
 * 桥接代码。
 *
 * **本文件不是 vitest 测试**——文件名以 `_` 开头并以 `.ts`（非 `.test.ts`）结尾，
 * 不会被 vitest 收集。仅作为 sibling 测试的 import 源。
 */

import { Effect, Stream } from "effect"
import type { TextStreamPart } from "ai"
import type { LLMStreamEvent } from "../../agent/tool-runtime"
import type { ProtocolAdapter } from "../_types"

/**
 * 把同步数组包成 AsyncIterable<TextStreamPart>。
 *
 * `Record<string, never>` 类型参数对齐 ProtocolAdapter.transform 的入参形态
 *（adapter 不感知 tool 集合，故 tool 元数据为空对象）。这与 `_shared.ts`
 * 中 `streamFromTextStreamParts` 的入参泛型一致。
 *
 * 测试场景中常常需要"一次性把所有 part 喂下去看 adapter 输出什么"——同步
 * 数组 → AsyncIterable 是最薄的桥接。
 */
export function mockTextStreamPartIterable(
  parts: ReadonlyArray<TextStreamPart<Record<string, never>>>,
): AsyncIterable<TextStreamPart<Record<string, never>>> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0
      return {
        async next() {
          if (i >= parts.length) return { value: undefined, done: true } as const
          const value = parts[i++]
          return { value, done: false } as const
        },
      }
    },
  }
}

/**
 * 让 adapter 跑完一组输入 part，把所有 `LLMStreamEvent` 收集成数组。
 *
 * 内部步骤：
 * 1. `mockTextStreamPartIterable` 把数组转 AsyncIterable
 * 2. `adapter.transform(...)` 得 `Stream.Stream<LLMStreamEvent, Error>`
 * 3. `Stream.runForEach` 遍历每个事件 push 到本地数组（与项目其他测试约定一致，
 *    见 [`tool-runtime.test.ts`](../../agent/tool-runtime.test.ts)、
 *    [`bus.test.ts`](../../bus/bus.test.ts)）
 * 4. `Effect.runPromise` 跑出 Promise<readonly LLMStreamEvent[]>
 *
 * 选 `runForEach` 而非 `runCollect`：项目其他 Effect 测试统一用 runForEach，
 * 避免在 Effect 4.0 beta 期 Chunk API 形态切换时多处适配。
 *
 * Adapter 内部抛错时（如 Stream.fromAsyncIterable 抛出的 Error）会以 rejected
 * Promise 体现——测试用 `await expect(...).rejects.toThrow(...)` 断言。
 */
export async function collectAdapterEvents(
  adapter: ProtocolAdapter,
  parts: ReadonlyArray<TextStreamPart<Record<string, never>>>,
): Promise<readonly LLMStreamEvent[]> {
  const stream = adapter.transform(mockTextStreamPartIterable(parts))
  const collected: LLMStreamEvent[] = []
  await Effect.runPromise(
    Stream.runForEach(stream, (event) =>
      Effect.sync(() => {
        collected.push(event)
      }),
    ),
  )
  return collected
}

/**
 * 用同步数组直接构造一个 `Stream<LLMStreamEvent, Error>`——给 prompt-style
 * 装饰器测试用：装饰器接受的是 inner adapter 已 emit 的 LLMStreamEvent 流，
 * 而不是 raw TextStreamPart 流；测试时不必再造 inner adapter，直接 mock 出
 * 装饰器的 inner stream 输出更直观。
 *
 * 配合 `makeFakeInnerAdapter` 使用。
 */
export function makeFakeInnerAdapter(
  protocolID: ProtocolAdapter["protocolID"],
  innerEvents: ReadonlyArray<LLMStreamEvent>,
): ProtocolAdapter {
  return {
    protocolID,
    transform: () => Stream.fromIterable(innerEvents),
  }
}
