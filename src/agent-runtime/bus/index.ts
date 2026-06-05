import { Effect, Layer, Context, PubSub, Stream, Scope } from "effect"

/**
 * Bus — Simple event bus for Agent Runtime.
 *
 * Uses Effect's PubSub for backpressure-aware publish/subscribe.
 * Adapted from OpenCode's bus system — simplified for HROps.
 */

// ─── Types ───────────────────────────────────────────────────────────

export type BusEvent = { id: string; type: string; data: unknown }

// ─── Service ─────────────────────────────────────────────────────────

export interface Interface {
  readonly publish: (type: string, data: unknown) => Effect.Effect<void>
  readonly subscribe: (type: string) => Stream.Stream<BusEvent>
  readonly subscribeAll: () => Stream.Stream<BusEvent>
}

export class Service extends Context.Service<Service, Interface>()("@agent-runtime/Bus") {}

// ─── Implementation ──────────────────────────────────────────────────

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const wildcard = yield* PubSub.unbounded<BusEvent>()
    const typed = new Map<string, PubSub.PubSub<BusEvent>>()

    const publish = (type: string, data: unknown) =>
      Effect.gen(function* () {
        const event: BusEvent = { id: crypto.randomUUID(), type, data }

        // Publish to type-specific pubsub
        let pubsub = typed.get(type)
        if (!pubsub) {
          pubsub = yield* PubSub.unbounded<BusEvent>()
          typed.set(type, pubsub)
        }
        yield* PubSub.publish(pubsub, event)

        // Also publish to wildcard
        yield* PubSub.publish(wildcard, event)
      })

    const subscribe = (type: string) => {
      let pubsub = typed.get(type)
      if (!pubsub) {
        // Create on demand — but we can't yield* here in a non-Effect context
        // So we use Stream.fromEffect to lazily create
        return Stream.fromEffect(Effect.gen(function* () {
          let p = typed.get(type)
          if (!p) {
            p = yield* PubSub.unbounded<BusEvent>()
            typed.set(type, p)
          }
          return p
        })).pipe(
          Stream.flatMap((p) => Stream.fromPubSub(p)),
        )
      }
      return Stream.fromPubSub(pubsub)
    }

    const subscribeAll = () => Stream.fromPubSub(wildcard)

    return Service.of({ publish, subscribe, subscribeAll })
  }),
)

export const defaultLayer = layer

export const Bus = { Service, defaultLayer, layer }