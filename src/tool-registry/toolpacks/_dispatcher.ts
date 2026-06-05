/**
 * Toolpack dispatcher — single point through which every toolpack invokes a
 * Tauri command. Built so unit tests can swap the dispatcher with an in-memory
 * mock (Q2 decision in 4.x impl plan).
 *
 * In production, `defaultDispatcher` simply delegates to `@tauri-apps/api/core`
 * `invoke`. In jsdom-based tests, callers may override via `setDispatcher(...)`.
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core"

export type Dispatcher = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>

const defaultDispatcher: Dispatcher = (command, args) => {
  console.log("[dispatcher] →", command, JSON.stringify(args))
  return tauriInvoke(command, args as never)
    .then((res) => {
      console.log("[dispatcher] ←", command, "ok, keys:", Object.keys(res ?? {}))
      return res
    })
    .catch((err) => {
      console.error("[dispatcher] ←", command, "ERROR:", err)
      throw err
    })
}

let current: Dispatcher = defaultDispatcher

/** Returns the active dispatcher (production or test override). */
export function getDispatcher(): Dispatcher {
  return current
}

/** Override the dispatcher (test-only). */
export function setDispatcher(d: Dispatcher): void {
  current = d
}

/** Reset to production dispatcher. */
export function resetDispatcher(): void {
  current = defaultDispatcher
}
