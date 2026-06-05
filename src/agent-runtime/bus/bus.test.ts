/**
 * Tests for the Bus module.
 *
 * Covers: publish, subscribe, subscribeAll
 */

import { describe, it, expect } from "vitest"
import { Effect, ManagedRuntime, Stream } from "effect"
import { Bus, type BusEvent } from "../bus/index"

describe("Bus — Service", () => {
  const rt = ManagedRuntime.make(Bus.defaultLayer)

  it("publishes and subscribes to typed events", async () => {
    const events: BusEvent[] = []

    // Subscribe first
    const subscription = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Bus.Service
        return service.subscribe("test-event")
      }),
    )

    // Consume the stream in the background
    const fiber = await Effect.runFork(
      Stream.runForEach(subscription, (event) =>
        Effect.sync(() => events.push(event))
      )
    )

    // Give subscription time to start
    await Effect.runPromise(Effect.sleep("10 millis"))

    // Publish an event
    await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Bus.Service
        yield* service.publish("test-event", { hello: "world" })
      }),
    )

    // Give time for event to be processed
    await Effect.runPromise(Effect.sleep("100 millis"))

    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].type).toBe("test-event")
    expect(events[0].data).toEqual({ hello: "world" })

    // No cleanup needed — fiber will be GC'd
  })

  it("publishes to subscribeAll stream", async () => {
    const events: BusEvent[] = []

    const subscription = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Bus.Service
        return service.subscribeAll()
      }),
    )

    const fiber = await Effect.runFork(
      Stream.runForEach(subscription, (event) =>
        Effect.sync(() => events.push(event))
      )
    )

    await Effect.runPromise(Effect.sleep("10 millis"))

    await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Bus.Service
        yield* service.publish("event-a", { a: 1 })
        yield* service.publish("event-b", { b: 2 })
      }),
    )

    await Effect.runPromise(Effect.sleep("100 millis"))

    expect(events.length).toBeGreaterThanOrEqual(2)
    const types = events.map((e) => e.type)
    expect(types).toContain("event-a")
    expect(types).toContain("event-b")

    // No cleanup needed — fiber will be GC'd
  })

  it("generates unique IDs for events", async () => {
    const events: BusEvent[] = []

    const subscription = await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Bus.Service
        return service.subscribeAll()
      }),
    )

    const fiber = await Effect.runFork(
      Stream.runForEach(subscription, (event) =>
        Effect.sync(() => events.push(event))
      )
    )

    await Effect.runPromise(Effect.sleep("10 millis"))

    await rt.runPromise(
      Effect.gen(function* () {
        const service = yield* Bus.Service
        yield* service.publish("id-test-1", {})
        yield* service.publish("id-test-2", {})
      }),
    )

    await Effect.runPromise(Effect.sleep("100 millis"))

    // IDs should be unique
    const ids = events.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)

    // No cleanup needed — fiber will be GC'd
  })

  afterAll(async () => {
    await rt.dispose()
  })
})
