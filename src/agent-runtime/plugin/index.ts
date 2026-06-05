import { Effect, Layer, Context } from "effect"

/**
 * Plugin System — Hook-based plugin architecture for extending Agent behavior.
 *
 * Adapted from OpenCode's plugin/index.ts (289 lines) — minimal stub for HROps V1:
 * - Removed: External plugin loading, Internal auth plugins, NPM plugin discovery,
 *   Plugin loader, Workspace adapters, Server integration
 * - Kept: Hook trigger interface (no-op for now)
 * - Future: Can add custom HR plugin hooks (e.g., pre-screening, post-screening)
 *
 * This stub ensures that code referencing `plugin.trigger()` doesn't break.
 * All trigger calls are no-ops that pass through the output unchanged.
 */

// ─── Types ───────────────────────────────────────────────────────────

export type HookHandler<Input = any, Output = any> = (input: Input, output: Output) => Promise<void>

export interface Hooks {
  "tool.execute.before"?: HookHandler
  "tool.execute.after"?: HookHandler
  "experimental.text.complete"?: HookHandler
  [key: string]: HookHandler | undefined
}

// ─── Service ─────────────────────────────────────────────────────────

export interface Interface {
  readonly trigger: <Output>(name: string, input: any, output: Output) => Effect.Effect<Output>
  readonly registerHook: (name: string, handler: HookHandler) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Hooks[]>
}

export class Service extends Context.Service<Service, Interface>()("@agent-runtime/Plugin") {}

// ─── Implementation ──────────────────────────────────────────────────

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hooks = new Map<string, HookHandler[]>()

    const trigger = Effect.fn("Plugin.trigger")(function* <Output>(name: string, input: any, output: Output) {
      const handlers = hooks.get(name) ?? []
      let currentOutput = output

      for (const handler of handlers) {
        yield* Effect.tryPromise({
          try: async () => {
            await handler(input, currentOutput)
          },
          catch: () => undefined,
        }).pipe(Effect.ignore)
      }

      return currentOutput
    })

    const registerHook = Effect.fn("Plugin.registerHook")(function* (name: string, handler: HookHandler) {
      const existing = hooks.get(name) ?? []
      existing.push(handler)
      hooks.set(name, existing)
    })

    const list = Effect.fn("Plugin.list")(function* () {
      // Return empty hooks list for now
      return []
    })

    return Service.of({ trigger, registerHook, list })
  }),
)

export const defaultLayer = layer

export const Plugin = { Service, defaultLayer, layer }
