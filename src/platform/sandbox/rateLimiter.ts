/**
 * rateLimiter — sliding-window rate limiter for tool invocations.
 *
 * Why JS-side rate limiting on top of Rust sandbox?
 *   The Rust sandbox enforces *path / host* whitelists, but a misbehaving
 *   user-source agent could still loop `read_file` thousands of times per
 *   second. This guard caps tool-call frequency before the call even
 *   reaches the bridge.
 *
 * Algorithm: simple sliding window over `windowMs`. We keep a deque of
 * call timestamps per key (typically `${agentName}:${toolName}`), prune
 * everything older than `now - windowMs`, then compare deque length to
 * `limit`.
 *
 * Defaults (from design.md ADR Phase B):
 *   - builtin source: unlimited (this module is bypassed)
 *   - user source:    60 calls / 60_000 ms per (agent, tool) key
 *   - marketplace:    30 calls / 60_000 ms per (agent, tool) key
 *
 * Usage:
 *   const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 })
 *   if (!limiter.tryAcquire(`${agent}:${tool}`)) {
 *     throw new RateLimitExceededError(...)
 *   }
 */

export interface RateLimiterOptions {
  readonly limit: number
  readonly windowMs: number
  /**
   * Optional clock override for tests. Defaults to `Date.now`.
   */
  readonly now?: () => number
}

export class RateLimitExceededError extends Error {
  readonly code = "RATE_LIMIT_EXCEEDED" as const
  constructor(
    readonly key: string,
    readonly limit: number,
    readonly windowMs: number,
  ) {
    super(
      `Rate limit exceeded for "${key}": ${limit} calls per ${windowMs}ms`,
    )
    this.name = "RateLimitExceededError"
  }
}

export interface RateLimiter {
  /** Returns true if the call is allowed (and records it); false otherwise. */
  tryAcquire(key: string): boolean
  /** Like `tryAcquire`, but throws `RateLimitExceededError` on rejection. */
  acquireOrThrow(key: string): void
  /** Number of timestamps currently retained for `key`. */
  size(key: string): number
  /** Wipe all state. */
  reset(): void
}

export const createRateLimiter = (opts: RateLimiterOptions): RateLimiter => {
  if (opts.limit <= 0) {
    throw new Error(`createRateLimiter: limit must be > 0 (got ${opts.limit})`)
  }
  if (opts.windowMs <= 0) {
    throw new Error(
      `createRateLimiter: windowMs must be > 0 (got ${opts.windowMs})`,
    )
  }
  const clock = opts.now ?? Date.now
  const buckets = new Map<string, number[]>()

  const prune = (key: string, now: number): number[] => {
    const arr = buckets.get(key)
    if (!arr) return []
    const cutoff = now - opts.windowMs
    // Mutate in-place: remove leading entries older than cutoff.
    let i = 0
    while (i < arr.length && arr[i]! < cutoff) i++
    if (i > 0) arr.splice(0, i)
    return arr
  }

  return {
    tryAcquire(key: string): boolean {
      const now = clock()
      const arr = prune(key, now)
      if (arr.length >= opts.limit) return false
      if (!buckets.has(key)) buckets.set(key, arr)
      arr.push(now)
      return true
    },
    acquireOrThrow(key: string): void {
      if (!this.tryAcquire(key)) {
        throw new RateLimitExceededError(key, opts.limit, opts.windowMs)
      }
    },
    size(key: string): number {
      return prune(key, clock()).length
    },
    reset(): void {
      buckets.clear()
    },
  }
}
