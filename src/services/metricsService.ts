/**
 * Metrics Service — in-memory event buffer with flush to audit log.
 *
 * Design notes:
 *   - record() is synchronous; writes to an in-memory buffer.
 *   - flush() writes buffered events to ~/.seven-hrops/audit/<date>.jsonl
 *     via the platform runtime's fs-toolpack. Falls back to console.log
 *     when the platform is not available.
 *   - Auto-flush triggers when the buffer reaches FLUSH_THRESHOLD.
 *   - getSessionMetrics() filters the buffer by sessionId.
 */

import type { MetricEvent, MetricEventType } from "@/types/metrics"

export type { MetricEvent, MetricEventType }

// ─── Internal state ──────────────────────────────────────────────────

const FLUSH_THRESHOLD = 100

let buffer: MetricEvent[] = []
let _flushFn: (() => Promise<void>) | null = null

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Record a metric event into the in-memory buffer.
 * Auto-flushes when buffer reaches FLUSH_THRESHOLD.
 */
export function record(event: MetricEvent): void {
  buffer.push(event)
  if (buffer.length >= FLUSH_THRESHOLD) {
    // Fire-and-forget auto-flush
    flush().catch((e) => console.error("[metricsService] auto-flush failed:", e))
  }
}

/**
 * Flush all buffered events to the audit log file.
 * Path: ~/.seven-hrops/audit/<YYYY-MM-DD>.jsonl
 */
export async function flush(): Promise<void> {
  if (buffer.length === 0) return

  const toFlush = buffer.slice()
  buffer = []

  // Use injected flush function (for testing) or platform runtime
  if (_flushFn) {
    try {
      await _flushFn()
    } catch (e) {
      console.error("[metricsService] flush failed:", e)
      buffer = [...toFlush, ...buffer]
    }
    return
  }

  const runtime =
    typeof window !== "undefined" ? (window as Window & { __platform?: { runtime: unknown } }).__platform?.runtime : null

  if (!runtime) {
    // Platform not available — log to console as fallback
    console.debug("[metricsService] flush (no platform):", toFlush.length, "events")
    return
  }

  try {
    const date = new Date().toISOString().split("T")[0]
    const lines = toFlush.map((e) => JSON.stringify(e)).join("\n") + "\n"
    const path = `~/.seven-hrops/audit/${date}.jsonl`

    // Use fs-toolpack via toolRegistry (L2→L1 call channel)
    const { toolRegistry } = await import("@/platform/registry/toolRegistry")
    await toolRegistry.invoke(
      "fs_write_text",
      { path, content: lines },
      { sessionId: "metrics", source: "builtin" },
    )
  } catch (e) {
    console.error("[metricsService] flush failed:", e)
    // Re-add to buffer on failure to avoid data loss
    buffer = [...toFlush, ...buffer]
  }
}

/**
 * Get all buffered events for a specific session.
 */
export function getSessionMetrics(sessionId: string): MetricEvent[] {
  return buffer.filter((e) => e.sessionId === sessionId)
}

/**
 * Get current buffer size (for testing / monitoring).
 */
export function getBufferSize(): number {
  return buffer.length
}

// ─── Test helpers ────────────────────────────────────────────────────

/**
 * @internal — tests only. Reset buffer and injected flush function.
 */
export function _resetForTest(): void {
  buffer = []
  _flushFn = null
}

/**
 * @internal — tests only. Inject a custom flush function.
 */
export function _injectFlushFn(fn: () => Promise<void>): void {
  _flushFn = fn
}
