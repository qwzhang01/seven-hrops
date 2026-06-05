import { Effect, Layer, Scope, Context } from "effect"

/**
 * InstanceState — Per-instance mutable state backed by Effect's Layer/MemoMap system.
 *
 * Each Instance (e.g., each Tauri window, each Agent session) gets its own
 * isolated state. The state is lazily initialized when first accessed and
 * cleaned up when the surrounding Scope closes.
 */

export interface InstanceStateAPI {
  readonly make: <T>(factory: (scope: Scope.Scope) => Effect.Effect<T>, opts?: { identifier?: string }) => Layer.Layer<T, never, Scope.Scope>
  readonly get: <T>(tag: Context.Service<T, T>) => Effect.Effect<T, never, T>
}

export class Service extends Context.Service<Service, InstanceStateAPI>()("@agent-runtime/InstanceState") {}

/**
 * Create an InstanceState-managed state Layer that:
 * 1. Lazily initializes via the provided factory function.
 * 2. Stores the state in the Layer memo map for singleton semantics within a runtime.
 * 3. Runs finalizers when the surrounding Scope closes.
 */
export function make<T>(factory: (scope: Scope.Scope) => Effect.Effect<T>, opts?: { identifier?: string }) {
  const identifier = opts?.identifier ?? `InstanceState/${Date.now()}`
  const tag = Context.Service<T, T>(identifier)

  return Layer.effect(
    tag,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      return yield* factory(scope)
    }),
  )
}

/**
 * Get the current state value for the given InstanceState tag.
 * This returns an Effect that resolves to the tag's current value from the context.
 */
export function get<T>(tag: Context.Service<T, T>): Effect.Effect<T, never, T> {
  return Effect.service(tag)
}

export const defaultLayer = Layer.succeed(
  Service,
  Service.of({ make, get }),
)

export const InstanceState = { make, get, Service, defaultLayer }
