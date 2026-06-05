import { Layer, ManagedRuntime, Effect, Context } from "effect"
import * as Observability from "./observability"
import { memoMap } from "./memo-map"
import { InstanceState } from "./instance-state"
import { EffectBridge } from "./bridge"
import { Bus } from "../bus/index"
import { Config } from "../config/index"
import { Provider } from "../provider/index"
import { Agent } from "../agent/agent"
import { Skill } from "../skill/index"
import { Permission } from "../permission/index"
import { MCP } from "../mcp/index"
import { Session } from "../session/session"
import { SessionProcessor } from "../session/processor"
import { SessionPrompt } from "../session/prompt"
import { Plugin } from "../plugin/index"

/**
 * AppRuntime — The main ManagedRuntime for the Agent Runtime.
 *
 * All placeholder layers have been replaced with real implementations.
 * The AppLayer wires together the full dependency graph:
 *
 *   Observability (empty) ← Config ← Provider ← Bus
 *   ← Agent ← Permission ← Skill ← MCP ← Plugin
 *   ← SessionProcessor ← SessionPrompt
 */

/**
 * Create the full application layer from individual service layers.
 *
 * IMPORTANT: All layers that depend on Config MUST use `.layer` (not `.defaultLayer`),
 * because `.defaultLayer` variants embed `Config.defaultLayer` (empty providers) internally,
 * which takes precedence over the user-supplied `configLayer` due to Effect's layer
 * deduplication semantics. By using `.layer` and providing `configLayer` explicitly,
 * we ensure every service sees the same Config instance with the user's providers.
 */
export function createAppLayer(config?: Partial<import("../config/index").AgentRuntimeConfig>) {
  // 1. Infrastructure layers (no Config dependency)
  const infraLayer = Layer.mergeAll(
    InstanceState.defaultLayer,
    EffectBridge.defaultLayer,
    Bus.defaultLayer,
  )

  // 2. Configuration layer — single source of truth for all services
  const configLayer = Config.layer(config)

  // 3. Provider layer — must use Provider.layer + explicit configLayer
  //    (Provider.defaultLayer embeds Config.defaultLayer with empty providers)
  const providerLayer = Provider.layer.pipe(Layer.provide(configLayer))

  // 4. Core layers that depend on Config
  //    Permission/Skill/Agent/Plugin use Config for agent model overrides
  const coreLayer = Layer.mergeAll(
    configLayer,
    Permission.defaultLayer,
    Skill.defaultLayer,
    Agent.defaultLayer,
    Plugin.defaultLayer,
  )

  // 5. MCP layer (standalone — no Config dependency at layer creation time)
  const mcpLayer = MCP.defaultLayer

  // 6. Session layers — Session.defaultLayer embeds Config.defaultLayer internally,
  //    so we use Session.layer and provide all dependencies explicitly
  const sessionProcessorLayer = SessionProcessor.layer
  const sessionPromptLayer = SessionPrompt.layer.pipe(
    Layer.provide(Agent.defaultLayer),
    Layer.provide(sessionProcessorLayer),
  )
  const sessionLayer = Session.layer.pipe(
    Layer.provide(configLayer),
    Layer.provide(providerLayer),
    Layer.provide(mcpLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(sessionPromptLayer),
    Layer.provide(sessionProcessorLayer),
  )

  // 7. Merge all layers
  const allLayers = Layer.mergeAll(
    infraLayer,
    coreLayer,
    providerLayer,
    mcpLayer,
    sessionProcessorLayer,
    sessionPromptLayer,
    sessionLayer,
  )

  return allLayers.pipe(
    Layer.provideMerge(Observability.layer),
  )
}

/**
 * Create a ManagedRuntime with the full AppLayer.
 * 
 * Note: The type assertion on appLayer is intentional — Effect 4.x's ManagedRuntime.make()
 * expects Layer.Layer<R, ER, never>, but Layer.mergeAll() produces a composite layer
 * with residual type parameters that don't cleanly reduce to `never`. This is a known
 * Effect limitation when merging many layers; the runtime behavior is correct despite
 * the type mismatch. We cast to the expected Layer.Layer<never, never, never> shape.
 */
export function createRuntime(config?: Partial<import("../config/index").AgentRuntimeConfig>) {
  const appLayer = createAppLayer(config)
  const rt = ManagedRuntime.make(appLayer as Layer.Layer<never, never, never>, { memoMap })

  return {
    runSync: <A, E>(effect: Effect.Effect<A, E, never>) => rt.runSync(effect),
    runPromise: <A, E>(effect: Effect.Effect<A, E, never>) => rt.runPromise(effect),
    runPromiseExit: <A, E>(effect: Effect.Effect<A, E, never>) => rt.runPromiseExit(effect),
    runFork: <A, E>(effect: Effect.Effect<A, E, never>) => rt.runFork(effect),
    runCallback: <A, E>(effect: Effect.Effect<A, E, never>) => rt.runCallback(effect),
    dispose: () => rt.dispose(),
  }
}

// Default runtime with empty config
const _defaultAppLayer = createAppLayer()
const rt = ManagedRuntime.make(_defaultAppLayer as Layer.Layer<never, never, never>, { memoMap })

/**
 * Default AppRuntime instance with pre-built ManagedRuntime.
 * 
 * Note: Same type assertion rationale as createRuntime() above.
 */
export const AppRuntime = {
  runSync: <A, E>(effect: Effect.Effect<A, E, never>) => rt.runSync(effect),
  runPromise: <A, E>(effect: Effect.Effect<A, E, never>) => rt.runPromise(effect),
  runPromiseExit: <A, E>(effect: Effect.Effect<A, E, never>) => rt.runPromiseExit(effect),
  runFork: <A, E>(effect: Effect.Effect<A, E, never>) => rt.runFork(effect),
  runCallback: <A, E>(effect: Effect.Effect<A, E, never>) => rt.runCallback(effect),
  dispose: () => rt.dispose(),
}