import { Effect, Layer, Context, Schema, Deferred } from "effect"

/**
 * Permission System — Controls what tools agents can use.
 *
 * Simplified for HROps:
 * - In-memory approval state (no database persistence)
 * - Auto-allow by default (HROps agents have well-defined tool boundaries)
 * - UI layer can intercept "ask" events to show permission dialogs
 */

// ─── Types ───────────────────────────────────────────────────────────

export const Action = Schema.Literals(["allow", "deny", "ask"])
export type Action = Schema.Schema.Type<typeof Action>

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
})
export type Rule = Schema.Schema.Type<typeof Rule>

export type Ruleset = Array<Rule>

// ─── Errors ──────────────────────────────────────────────────────────

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Array(Rule),
}) {
  override get message() {
    return `Permission denied by ruleset`
  }
}

export type PermError = DeniedError | RejectedError

// ─── Evaluation ──────────────────────────────────────────────────────

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): { permission: string; pattern: string; action: Action } {
  const rules = rulesets.flat()
  const match = [...rules].reverse().find(
    (rule: { permission: string; pattern: string; action: "allow" | "deny" | "ask" }) =>
      wildcardMatch(permission, rule.permission) &&
      wildcardMatch(pattern, rule.pattern),
  )
  return match ?? { action: "ask" as const, permission, pattern: "*" }
}

function wildcardMatch(str: string, pattern: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith("*")) {
    return str.startsWith(pattern.slice(0, -1))
  }
  return str === pattern
}

export function merge(...rulesets: Ruleset[]): Ruleset {
  return rulesets.flat()
}

// ─── Service ─────────────────────────────────────────────────────────

export interface AskInput {
  readonly permission: string
  readonly patterns: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
  readonly always?: ReadonlyArray<string>
  readonly ruleset: Ruleset
  readonly sessionID?: string
}

export interface ReplyInput {
  readonly requestID: string
  readonly reply: "once" | "always" | "reject"
  readonly message?: string
  readonly always?: ReadonlyArray<string>
}

interface PendingEntry {
  id: string
  permission: string
  patterns: string[]
  sessionID?: string
  deferred: Deferred.Deferred<void, RejectedError>
}

interface State {
  pending: Map<string, PendingEntry>
  approved: Ruleset
}

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<void, PermError>
  readonly reply: (input: ReplyInput) => Effect.Effect<void>
  readonly list: () => Effect.Effect<ReadonlyArray<{ id: string; permission: string; patterns: string[] }>>
  readonly setApproved: (rules: Ruleset) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@agent-runtime/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state: State = {
      pending: new Map(),
      approved: [],
    }

    const ask = (input: AskInput) =>
      Effect.gen(function* () {
        const { ruleset, ...request } = input
        let needsAsk = false

        for (const pattern of request.patterns) {
          const rule = evaluate(request.permission, pattern, ruleset, state.approved)
          if (rule.action === "deny") {
            return yield* new DeniedError({
              ruleset: ruleset.filter((r) => wildcardMatch(request.permission, r.permission)),
            })
          }
          if (rule.action === "allow") continue
          needsAsk = true
        }

        if (!needsAsk) return

        const id = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const deferred = yield* Deferred.make<void, RejectedError>()

        state.pending.set(id, {
          id,
          permission: request.permission,
          patterns: request.patterns as string[],
          sessionID: request.sessionID,
          deferred,
        })

        // Auto-allow by default for HROps.
        // The UI layer can intercept this and show a dialog instead.
        yield* Deferred.succeed(deferred, undefined)
        state.pending.delete(id)
      })

    const reply = (input: ReplyInput) =>
      Effect.gen(function* () {
        const existing = state.pending.get(input.requestID)
        if (!existing) return

        state.pending.delete(input.requestID)

        if (input.reply === "reject") {
          yield* Deferred.fail(existing.deferred, new RejectedError())
          return
        }

        yield* Deferred.succeed(existing.deferred, undefined)

        if (input.reply === "always" && input.always) {
          for (const pattern of input.always) {
            state.approved.push({
              permission: existing.permission,
              pattern,
              action: "allow" as const,
            })
          }
        }
      })

    const list = () => Effect.gen(function* () {
      return Array.from(state.pending.values()).map((entry) => ({
        id: entry.id,
        permission: entry.permission,
        patterns: entry.patterns,
      }))
    })

    const setApproved = (rules: Ruleset) =>
      Effect.sync(() => {
        state.approved = rules
      })

    return Service.of({ ask, reply, list, setApproved })
  }),
)

export const defaultLayer = layer

export const Permission = { Service, defaultLayer, layer, evaluate, merge }
