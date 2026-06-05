/**
 * Regression tests for SessionProcessor.
 *
 * Covers two error-handling paths that previously caused the UI to get
 * stuck on the "..." typing indicator:
 *
 *  1. The LLM stream finishes "successfully" but emits an in-band
 *     `{ type: "error" }` event (typical AI SDK behaviour for HTTP 4xx).
 *  2. The underlying Effect stream itself fails (fetch rejection etc.).
 *
 * In both cases the processor MUST emit an `error` event to the UI and
 * return a `finishReason === "error"` result so the typing indicator
 * stops and the user sees what went wrong.
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer, ManagedRuntime, Stream } from "effect"
import { SessionProcessor, type ProcessorEvent } from "./processor"
import type { LLMStreamEvent } from "../agent/tool-runtime"

const runtime = ManagedRuntime.make(SessionProcessor.defaultLayer)

const collectEvents = async (events: ReadonlyArray<LLMStreamEvent>) => {
  const collected: ProcessorEvent[] = []
  const result = await runtime.runPromise(
    Effect.gen(function* () {
      const svc = yield* SessionProcessor.Service
      const handle = yield* svc.create({
        sessionID: "session-test",
        messageID: "msg-test",
        agentName: "assistant",
        onEvent: (e) => {
          collected.push(e)
        },
      })
      const stream = Stream.fromIterable(events) as Stream.Stream<LLMStreamEvent, Error>
      return yield* handle.process(stream)
    }),
  )
  return { collected, result }
}

describe("SessionProcessor — error handling", () => {
  it("surfaces in-band LLM error events as error+finish to the UI", async () => {
    const { collected, result } = await collectEvents([
      { type: "error", error: new Error("404 model not found") },
      // AI SDK typically still closes the stream after an error event.
      // We do NOT emit a normal "finish" here — the processor must
      // synthesise one so the UI's typing indicator stops.
    ])

    const errorEvents = collected.filter((e) => e.type === "error")
    const finishEvents = collected.filter((e) => e.type === "finish")

    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].data).toMatchObject({
      type: "error",
      error: expect.stringContaining("404"),
    })
    expect(finishEvents).toHaveLength(1)
    expect(finishEvents[0].data).toMatchObject({ type: "finish", reason: "error" })
    expect(result.finishReason).toBe("error")
    expect(result.error).toContain("404")
  })

  it("emits error+finish when the stream itself fails (transport error)", async () => {
    const failing = Stream.fail(new Error("fetch failed: ECONNREFUSED")) as Stream.Stream<
      LLMStreamEvent,
      Error
    >

    const collected: ProcessorEvent[] = []
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const svc = yield* SessionProcessor.Service
        const handle = yield* svc.create({
          sessionID: "session-test",
          messageID: "msg-test",
          agentName: "assistant",
          onEvent: (e) => collected.push(e),
        })
        return yield* handle.process(failing)
      }),
    )

    const errorEvents = collected.filter((e) => e.type === "error")
    const finishEvents = collected.filter((e) => e.type === "finish")

    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].data).toMatchObject({
      type: "error",
      error: expect.stringContaining("ECONNREFUSED"),
    })
    expect(finishEvents).toHaveLength(1)
    expect(result.finishReason).toBe("error")
    expect(result.error).toContain("ECONNREFUSED")
  })

  it("emits a fallback finish when the stream is empty and no finish event arrives", async () => {
    const { collected, result } = await collectEvents([])

    const finishEvents = collected.filter((e) => e.type === "finish")
    expect(finishEvents).toHaveLength(1)
    expect(result.finishReason).toBe("empty")
    expect(result.error).toBeUndefined()
  })

  it("preserves normal text + finish flow without injecting extra events", async () => {
    const { collected, result } = await collectEvents([
      { type: "text-delta", text: "hello" },
      { type: "text-delta", text: " world" },
      { type: "finish", reason: "stop" },
    ])

    const errorEvents = collected.filter((e) => e.type === "error")
    const finishEvents = collected.filter((e) => e.type === "finish")
    const textCompleteEvents = collected.filter((e) => e.type === "text-complete")

    expect(errorEvents).toHaveLength(0)
    expect(finishEvents).toHaveLength(1)
    expect(finishEvents[0].data).toMatchObject({ type: "finish", reason: "stop" })
    expect(textCompleteEvents).toHaveLength(1)
    expect(textCompleteEvents[0].data).toMatchObject({
      type: "text-complete",
      text: "hello world",
    })
    expect(result.finishReason).toBe("stop")
  })
})
