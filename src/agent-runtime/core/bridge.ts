import { Effect, Layer, Context } from "effect"

/**
 * EffectBridge — bridges Effect runtime into Promise-returning JS callbacks.
 *
 * This is essential when Effect code needs to cross the boundary into
 * plain JS/TS code that operates with Promises (e.g., Tauri invoke callbacks,
 * React state setters, legacy modules).
 */

export interface Shape {
  readonly promise: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>
  readonly fork: <A, E, R>(effect: Effect.Effect<A, E, R>) => void
  readonly run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E>
}

export class Service extends Context.Service<Service, Shape>()("@agent-runtime/EffectBridge") {}

export const defaultLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const ctx = yield* Effect.context()

    const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.provide(effect, ctx) as Effect.Effect<A, E, never>

    return Service.of({
      promise: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.runPromise(wrap(effect)),

      fork: <A, E, R>(effect: Effect.Effect<A, E, R>) => {
        Effect.runFork(wrap(effect))
      },

      run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.callback<A, E>((resume) => {
          Effect.runPromiseExit(wrap(effect)).then((exit) => {
            if (exit._tag === "Success") {
              resume(Effect.succeed(exit.value))
            } else {
              resume(Effect.failCause(exit.cause))
            }
          })
        }),
    })
  }),
)

export const EffectBridge = { Service, defaultLayer, make: defaultLayer }