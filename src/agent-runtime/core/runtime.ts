import { Layer, ManagedRuntime, Effect, Context, Exit, Fiber } from "effect"

/**
 * Global memoMap — shared across all ManagedRuntime instances.
 * Ensures Layer singletons are shared across different runtimes.
 *
 * In Effect 4.x, Layer.makeMemoMap returns an object with a .build method.
 * We use makeMemoMapUnsafe to create a lazy, mutable MemoMap.
 */
export const memoMap = Layer.makeMemoMapUnsafe()

/**
 * Observability — No-op layer for now.
 * Replace with OpenTelemetry integration when needed.
 */
export const Observability = {
  layer: Layer.empty,
}

/**
 * makeRuntime — Create a ManagedRuntime for the given layer.
 * Uses the global memoMap to ensure Layer singletons are shared.
 */
export function makeRuntime<A, E>(
  layer: Layer.Layer<A, E>,
) {
  const rt = ManagedRuntime.make(layer, { memoMap })
  return {
    runSync: rt.runSync.bind(rt) as <A2, E2>(effect: Effect.Effect<A2, E2, A>) => A2,
    runPromise: rt.runPromise.bind(rt) as <A2, E2>(effect: Effect.Effect<A2, E2, A>) => Promise<A2>,
    runPromiseExit: rt.runPromiseExit.bind(rt) as <A2, E2>(effect: Effect.Effect<A2, E2, A>) => Promise<Exit.Exit<A2, E2>>,
    runFork: rt.runFork.bind(rt) as <A2, E2>(effect: Effect.Effect<A2, E2, A>) => Fiber.Fiber<A2, E2>,
    dispose: () => rt.dispose(),
  }
}

// Re-export for convenience
export { Exit, Fiber }