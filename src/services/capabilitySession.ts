/**
 * capabilitySession — maps a Capability ID (e.g. "resume-screening") to a
 * stable session ID that ChatWorkspace can use across re-renders.
 *
 * Design notes:
 *
 *   - **In-memory only.** MVB does not persist sessions. Phase 1+ will
 *     persist them via Tauri / SQLite.
 *
 *   - **Idempotent.** `getOrCreate(id)` returns the same session ID every
 *     time it is called for the same capability — that is the key reason
 *     this module exists separately from `agentService`.
 */

let counter = 0;
const sessions = new Map<string, string>();

const newSessionID = (capabilityId: string): string => {
  counter += 1;
  const safeCap = capabilityId.replace(/[^a-z0-9-]/gi, "-");
  return `session-${safeCap}-${Date.now()}-${counter}`;
};

/**
 * Resolve the session ID for a capability, creating a fresh one the first
 * time the capability is activated in the current JS context.
 */
export function getOrCreate(capabilityId: string): string {
  const existing = sessions.get(capabilityId);
  if (existing) return existing;
  const sid = newSessionID(capabilityId);
  sessions.set(capabilityId, sid);
  return sid;
}

/**
 * Forget the session for a capability. The next call to `getOrCreate`
 * for the same capability will allocate a fresh ID.
 */
export function reset(capabilityId: string): void {
  sessions.delete(capabilityId);
}

/**
 * Test-only: clear every mapping.
 */
export function resetAllForTest(): void {
  sessions.clear();
  counter = 0;
}

/**
 * Test-only: peek without creating.
 */
export function peek(capabilityId: string): string | undefined {
  return sessions.get(capabilityId);
}
