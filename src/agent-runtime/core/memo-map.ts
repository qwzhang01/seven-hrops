import { Layer } from "effect"

/**
 * Global memoMap instance shared across all ManagedRuntime instances.
 * Ensures Layer singletons are shared across different runtimes.
 */
export const memoMap = Layer.makeMemoMapUnsafe()
