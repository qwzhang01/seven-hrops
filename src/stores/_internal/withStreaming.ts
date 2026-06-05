/**
 * withStreaming — terminal-state guard for store actions that drive a
 * streaming service.
 *
 * Spec reference:
 *   - openspec/changes/arch-capability-agent-contract/specs/ai-store-chat/spec.md
 *   - openspec/changes/arch-capability-agent-contract/specs/platform-foundation/spec.md
 *     ("\u72b6\u6001\u5b57\u6bb5\u5fc5\u987b\u6709\u7ec8\u6001\u4fdd\u8bc1")
 *
 * Why this helper exists:
 *   The previous `aiStore.sendMessage` resetted `isTyping` in three
 *   different code paths (`finish` event, `error` event, outer catch).
 *   When the underlying stream resolved without emitting `finish`
 *   (provider returned `[DONE]` early, fetch aborted mid-flight, etc.)
 *   `isTyping` stayed `true` forever and the UI got stuck on `\u2026`. This
 *   helper centralises the `try / catch / finally` pattern so callers
 *   only describe **what** to do, not **how** to recover.
 *
 * Design (see design.md "\u51b3\u7b56 4"):
 *   - Helper is a plain function, not a zustand middleware. The store
 *     action constructs a `StreamingHandle` whose `setFlag` and `onError`
 *     close over `set/get`.
 *   - Helper never touches the store directly \u2014 it only calls into
 *     `handle.setFlag` / `handle.onError`. This keeps the helper
 *     testable without zustand.
 *   - All thrown values are normalised to `Error` before reaching
 *     `onError`, so consumers can rely on `err instanceof Error` and
 *     `err.message`.
 *   - The finally block is the **only** place where `setFlag(false)`
 *     fires \u2014 don't sprinkle resets inside the body.
 */

export interface StreamingHandle<TState = unknown> {
  /** Toggle the in-progress flag (e.g. `isTyping` / `loading` / `streaming`). */
  readonly setFlag: (value: boolean) => void
  /**
   * Receive the normalised error so the action can map it to an error
   * message, log it, etc. The helper guarantees `err` is an `Error`
   * instance (strings / unknown values get wrapped via `new Error(String(...))`).
   */
  readonly onError: (err: Error) => void
  /** Optional state ref for advanced callers; unused by the helper itself. */
  readonly state?: TState
}

/**
 * Wrap a streaming action body so the in-progress flag is always reset.
 *
 * @param handle  Closures over the store's `setFlag` / `onError`.
 * @param body    The async work to run with the flag set to true.
 *
 * Resolves once `body` resolves or its rejection is reported to
 * `onError`; never re-throws (the caller's job is finished as soon as
 * the flag is back to false).
 */
export async function withStreaming<TState = unknown>(
  handle: StreamingHandle<TState>,
  body: () => Promise<void>,
): Promise<void> {
  handle.setFlag(true)
  try {
    await body()
  } catch (err) {
    const normalised = err instanceof Error ? err : new Error(String(err))
    try {
      handle.onError(normalised)
    } catch {
      // onError must never crash the flag-reset; swallow defensively.
    }
  } finally {
    handle.setFlag(false)
  }
}
