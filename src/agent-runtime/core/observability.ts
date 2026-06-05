import { Layer } from "effect"

/**
 * Observability — No-op layer for the Agent Runtime.
 *
 * When OpenTelemetry is needed, replace this with a proper implementation
 * using @effect/opentelemetry and effect/unstable/observability.
 */
export const enabled = false

export const layer = Layer.empty
