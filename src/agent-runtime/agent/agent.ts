import { Effect, Context, Layer, Schema } from "effect"

/**
 * Agent.Info — Schema for an Agent definition.
 *
 * Adapted from OpenCode's Agent.Info but simplified for HROps:
 * - Removed: native, hidden, variant, steps, reference, color, topP
 * - Added: tools (explicit tool list for the agent)
 * - Simplified: mode is now "primary" | "subagent" (removed "all")
 *
 * Each Agent has:
 * - name: unique identifier
 * - description: when to use this agent
 * - mode: "primary" = top-level user-facing, "subagent" = called by other agents
 * - model: optional model override
 * - prompt: system prompt template
 * - permission: ruleset controlling what tools this agent can use
 * - tools: explicit list of tools this agent can call
 * - temperature: model temperature override
 */

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  mode: Schema.Literals(["subagent", "primary"]),
  model: Schema.optional(
    Schema.Struct({
      modelID: Schema.String,
      providerID: Schema.String,
    }),
  ),
  prompt: Schema.optional(Schema.String),
  permission: Schema.Array(
    Schema.Struct({
      permission: Schema.String,
      pattern: Schema.String,
      action: Schema.Literals(["allow", "deny", "ask"]),
    }),
  ),
  tools: Schema.optional(Schema.Array(Schema.String)),
  temperature: Schema.optional(Schema.Number),
})
export type Info = Schema.Schema.Type<typeof Info>

/**
 * Agent.Service — Context service for Agent management.
 *
 * v2.0 platform foundation: built-in agents are no longer hardcoded here.
 * Agents are registered exclusively through `AgentLoader` (which reads
 * HSAS Manifests). The Service is a pure runtime registry.
 */
export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info>
  readonly has: (name: string) => Effect.Effect<boolean>
  readonly list: () => Effect.Effect<Info[]>
  readonly defaultAgent: () => Effect.Effect<string>
  readonly register: (agent: Info) => Effect.Effect<void>
  readonly unregister: (name: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@agent-runtime/Agent") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // Mutable registry of agents — populated at runtime via `register`
    // (typically by the AgentLoader during platform bootstrap).
    const agents = new Map<string, Info>()

    const get = Effect.fn("Agent.get")(function* (name: string) {
      const agent = agents.get(name)
      if (!agent) throw new Error(`Agent "${name}" not found`)
      return agent
    })

    const has = Effect.fn("Agent.has")(function* (name: string) {
      return agents.has(name)
    })

    const list = Effect.fn("Agent.list")(function* () {
      return Array.from(agents.values()).sort((a, b) => {
        // Primary agents first, then alphabetical
        if (a.mode !== b.mode) return a.mode === "primary" ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    })

    const defaultAgent = Effect.fn("Agent.defaultAgent")(function* () {
      const primary = Array.from(agents.values()).find((a) => a.mode === "primary")
      if (!primary) throw new Error("No primary agent found")
      return primary.name
    })

    const register = Effect.fn("Agent.register")(function* (agent: Info) {
      if (agents.has(agent.name)) {
        throw new Error(`Agent "${agent.name}" already exists`)
      }
      agents.set(agent.name, agent)
    })

    const unregister = Effect.fn("Agent.unregister")(function* (name: string) {
      if (!agents.has(name)) {
        throw new Error(`Agent "${name}" not found`)
      }
      agents.delete(name)
    })

    return Service.of({ get, has, list, defaultAgent, register, unregister })
  }),
)

export const defaultLayer = layer

export const Agent = { Info, Service, defaultLayer, layer }

// Type-only namespace so consumers can write `Agent.Service` / `Agent.Info`
// in type positions (e.g. `Effect.Effect<..., ..., Agent.Service>`).
// Without this merge, `Agent` is a value-only binding and TS rejects
// `Agent.Service` as a namespace reference (TS2503).
export namespace Agent {
  export type Service = InstanceType<typeof Service>
  export type Info = Schema.Schema.Type<typeof Info>
}
