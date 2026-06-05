/**
 * capabilityResolver — the single, fail-fast entry point for translating a
 * `capabilityId` string identity into the business-relevant fields the
 * Service / Store / Component layers actually care about (`agentName`,
 * `contextKeys`, `displayName`, `source`).
 *
 * Spec reference:
 *   - openspec/changes/arch-capability-agent-contract/specs/capability-resolver/spec.md
 *
 * Contract:
 *   - capabilityRegistry stays the "raw data access layer".
 *   - resolveCapability is the "business semantics layer". Service layer
 *     code MUST go through this function and MUST NOT reach into
 *     `capabilityRegistry.get(id)?.manifest.spec.agentName` style chains.
 *
 * No IO side effects: this module only reads the in-memory map maintained
 * by capabilityRegistry. Validation of the underlying manifest already
 * happens at install-time, so by the time resolveCapability runs the
 * agentName / contextKeys etc. are guaranteed to be well-formed.
 */

import {
  capabilityRegistry,
  type CapabilityRecord,
  type Source,
} from "./capabilityRegistry"
import type { CapabilityManifest } from "../hsas/schema"

// ─── Public types ────────────────────────────────────────────────────

export interface ResolvedCapability {
  readonly capabilityId: string
  readonly agentName: string
  readonly contextKeys: ReadonlyArray<string>
  readonly displayName: string
  readonly source: Source
  readonly manifest: CapabilityManifest
  readonly record: CapabilityRecord
  /**
   * Whether this capability requires a workspace for file I/O.
   * Defaults to `false` when not declared in the manifest.
   *
   * Spec reference: openspec/changes/use_def/session-workspace-binding/design.md §D2
   */
  readonly needsWorkspace: boolean
}

// ─── Errors ──────────────────────────────────────────────────────────

export class CapabilityNotFoundError extends Error {
  readonly code = "CAP_NOT_FOUND"
  readonly capabilityId: string
  constructor(capabilityId: string) {
    const display = capabilityId.length === 0 ? "(empty)" : capabilityId
    super(`Capability "${display}" is not registered`)
    this.name = "CapabilityNotFoundError"
    this.capabilityId = capabilityId
  }
}

export class CapabilityDisabledError extends Error {
  readonly code = "CAP_DISABLED"
  readonly capabilityId: string
  readonly displayName: string
  constructor(capabilityId: string, displayName: string) {
    super(
      `Capability "${capabilityId}" (${displayName}) is registered but disabled`,
    )
    this.name = "CapabilityDisabledError"
    this.capabilityId = capabilityId
    this.displayName = displayName
  }
}

// ─── Resolver ────────────────────────────────────────────────────────

/**
 * Resolve a `capabilityId` to its business-facing fields. Fail-fast:
 * empty / unknown / disabled capabilities throw a typed error so the
 * caller can map it to a user-readable message in one place.
 *
 * @throws CapabilityNotFoundError when id is empty / undefined / unknown
 * @throws CapabilityDisabledError when the capability exists but is disabled
 */
export function resolveCapability(capabilityId: string): ResolvedCapability {
  // Treat undefined / null / "" uniformly — the type signature requires
  // `string`, but at runtime callers may pass `undefined as any` (e.g.
  // tests, or stale persisted state). We always fail-fast here.
  if (!capabilityId || typeof capabilityId !== "string") {
    throw new CapabilityNotFoundError(
      typeof capabilityId === "string" ? capabilityId : "",
    )
  }

  const record = capabilityRegistry.get(capabilityId)
  if (!record) {
    throw new CapabilityNotFoundError(capabilityId)
  }
  if (!record.enabled) {
    throw new CapabilityDisabledError(
      capabilityId,
      record.manifest.metadata.displayName,
    )
  }

  return {
    capabilityId,
    agentName: record.manifest.spec.agentName,
    contextKeys: record.manifest.spec.contextKeys,
    displayName: record.manifest.metadata.displayName,
    source: record.source,
    manifest: record.manifest,
    record,
    needsWorkspace: record.manifest.spec.needsWorkspace ?? false,
  }
}

/**
 * Resolve whether a capability requires a workspace for file I/O.
 *
 * This is a convenience wrapper around `resolveCapability` for callers
 * that only need the `needsWorkspace` flag (e.g. `sessionStore.createSession`).
 *
 * Fail-fast: throws `CapabilityNotFoundError` / `CapabilityDisabledError`
 * for unknown / disabled capabilities — same contract as `resolveCapability`.
 *
 * @throws CapabilityNotFoundError when id is empty / undefined / unknown
 * @throws CapabilityDisabledError when the capability exists but is disabled
 */
export function resolveWorkspaceNeeds(capabilityId: string): boolean {
  return resolveCapability(capabilityId).needsWorkspace
}
