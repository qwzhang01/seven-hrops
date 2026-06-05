/**
 * dryRun — invocation interceptor that records would-be tool calls
 * instead of dispatching them.
 *
 * Used by:
 *   - `agent-runtime` smoke tests that want to assert "agent X would
 *     call tool Y with args Z" without producing real side effects.
 *   - The marketplace preview UI (Phase G) where a user inspects what a
 *     candidate manifest *would* do before installing it.
 *
 * Usage:
 *   const dr = createDryRun()
 *   const wrapped = dr.wrap(realInvoker)
 *   await wrapped("read_file", { path: "/etc/hosts" }, ctx)
 *   dr.calls // → [{ name: "read_file", args: {...}, ctx }]
 *
 * The wrapped function returns a synthetic envelope so the caller's
 * downstream code (which expects `unknown`) can still pattern-match if
 * needed.
 */

export interface DryRunCall {
  readonly name: string
  readonly args: unknown
  readonly ctx: unknown
  readonly at: number
}

export interface DryRunEnvelope {
  readonly __dryRun: true
  readonly name: string
  readonly args: unknown
}

export interface DryRunner<I extends (...args: never[]) => unknown> {
  /** All recorded calls in chronological order. */
  readonly calls: ReadonlyArray<DryRunCall>
  /** Wrap an invoker so it records instead of dispatching. */
  wrap(invoker: I): I
  /** Reset the recorded log (does not affect already-wrapped invokers). */
  reset(): void
}

// Generic invoker shape: (name, args, ctx) → result. Matches both
// `toolRegistry.invoke` and any custom dispatcher.
type AnyInvoker = (name: string, args: unknown, ctx: unknown) => unknown

export const createDryRun = <I extends AnyInvoker = AnyInvoker>(): DryRunner<I> => {
  const log: DryRunCall[] = []
  return {
    get calls() {
      return log as ReadonlyArray<DryRunCall>
    },
    wrap(_invoker: I): I {
      const wrapped: AnyInvoker = (name, args, ctx) => {
        log.push({ name, args, ctx, at: Date.now() })
        const env: DryRunEnvelope = { __dryRun: true, name, args }
        return env
      }
      return wrapped as I
    },
    reset(): void {
      log.length = 0
    },
  }
}

export const isDryRunEnvelope = (v: unknown): v is DryRunEnvelope =>
  typeof v === "object" && v !== null && (v as DryRunEnvelope).__dryRun === true
