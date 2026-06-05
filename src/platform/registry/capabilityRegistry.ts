/**
 * CapabilityRegistry — single source of truth for UI entry-point cards.
 *
 * Spec reference:
 *   - openspec/changes/platform-foundation-mvb/specs/capability-registry/spec.md
 *   - doc/agent-architecture/00-总架构设计.md (Capability 概念)
 *
 * Responsibilities:
 *   - install(manifest): validate, then add a CapabilityRecord
 *   - uninstall(name): remove (forbidden for builtin)
 *   - enable / disable: toggle the `enabled` flag
 *   - get / list: query the catalogue (with sort + filter)
 *   - subscribe: observe lifecycle events
 *
 * Threading model: synchronous singleton (matches `toolRegistry`). All
 * mutations happen on the JS event loop with no async gaps, so listeners
 * always observe a consistent snapshot.
 */

import { validateSync, ValidationError, type ValidationContext } from "../hsas/validator"
import type { AnyManifest, CapabilityManifest } from "../hsas/schema"
import { parse as parseYaml } from "yaml"

// ─── Types ───────────────────────────────────────────────────────────

export type Source = "builtin" | "user" | "marketplace"

export interface CapabilityRecord {
  readonly manifest: CapabilityManifest
  /**
   * Canonical identifier — equals `manifest.metadata.name`. Hoisted here
   * so consumers can match by id without reaching into the manifest, and so
   * that name can be internationalised/renamed in the future without
   * breaking id-based lookups.
   */
  readonly id: string
  /**
   * Hoisted from `manifest.metadata.source` for fast UI access (sidebar
   * sorting / source-pill rendering). Always identical to the value inside
   * the manifest — single source of truth still lives in the manifest.
   */
  readonly source: Source
  readonly enabled: boolean
  readonly installedAt: number
}

export type Action = "install" | "uninstall" | "enable" | "disable"

/** @deprecated kept as an alias for back-compat; prefer `Action`. */
export type Event = Action

/**
 * Subscribe payload — single-argument object form so future fields
 * (e.g. `prevRecord` for transitions) can be added without breaking
 * positional listeners.
 */
export interface SubscriptionEvent {
  readonly action: Action
  readonly record: CapabilityRecord
}

export type Listener = (event: SubscriptionEvent) => void

export interface ListFilter {
  readonly source?: "builtin" | "user" | "marketplace"
  readonly enabled?: boolean
}

export interface InstallOptions {
  /**
   * Optional ValidationContext. When omitted the registry validates only the
   * intrinsic schema (no cross-registry checks). Bootstrap supplies an
   * `agentExists` predicate so that `AGENT_NOT_FOUND` is enforced.
   */
  readonly validationContext?: ValidationContext
}

// ─── State ───────────────────────────────────────────────────────────

const records = new Map<string, CapabilityRecord>()
const listeners = new Set<Listener>()

// ─── Internal helpers ────────────────────────────────────────────────

const emit = (record: CapabilityRecord, action: Action): void => {
  const ev: SubscriptionEvent = { action, record }
  for (const fn of listeners) {
    try {
      fn(ev)
    } catch {
      // Listener errors must never crash the registry.
    }
  }
}

const orderOf = (m: CapabilityManifest): number => m.spec.order ?? 999

// ─── Public API ──────────────────────────────────────────────────────

const install = (raw: unknown, opts: InstallOptions = {}): CapabilityRecord => {
  // Validate first. Throws ValidationError on failure — this is the
  // "no-pollution" contract: the registry stays untouched if anything fails.
  const manifest = validateSync(raw, opts.validationContext) as AnyManifest
  if (manifest.kind !== "Capability") {
    throw new ValidationError(
      "INVALID_KIND",
      `capabilityRegistry.install received kind="${manifest.kind}"`,
    )
  }
  const cm = manifest as CapabilityManifest

  if (records.has(cm.metadata.name)) {
    throw new ValidationError(
      "DUPLICATE_NAME",
      `Capability with name "${cm.metadata.name}" is already installed`,
      { name: cm.metadata.name },
    )
  }

  const record: CapabilityRecord = {
    manifest: cm,
    id: cm.metadata.name,
    source: cm.metadata.source,
    enabled: true,
    installedAt: Date.now(),
  }
  records.set(cm.metadata.name, record)
  emit(record, "install")
  return record
}

/**
 * Convenience wrapper: parse a YAML string then `install`. Centralises
 * YAML→JS conversion so callers (loader, bootstrap, marketplace import
 * UI) don't each re-implement it.
 *
 * Throws `ValidationError("YAML_PARSE_FAILED", ...)` on malformed YAML so
 * the no-pollution contract still applies.
 */
const installFromYaml = (
  yamlText: string,
  opts: InstallOptions = {},
): CapabilityRecord => {
  let raw: unknown
  try {
    raw = parseYaml(yamlText)
  } catch (e) {
    throw new ValidationError(
      "YAML_PARSE_FAILED",
      `capabilityRegistry.installFromYaml: ${(e as Error).message}`,
    )
  }
  return install(raw, opts)
}

const uninstall = (name: string): void => {
  const rec = records.get(name)
  if (!rec) {
    throw new Error(`Capability "${name}" not found`)
  }
  if (rec.manifest.metadata.source === "builtin") {
    throw new Error(`Cannot uninstall builtin capability "${name}" — use disable instead`)
  }
  records.delete(name)
  emit(rec, "uninstall")
}

const enable = (name: string): CapabilityRecord => {
  const rec = records.get(name)
  if (!rec) throw new Error(`Capability "${name}" not found`)
  if (rec.enabled) return rec
  const next: CapabilityRecord = { ...rec, enabled: true }
  records.set(name, next)
  emit(next, "enable")
  return next
}

const disable = (name: string): CapabilityRecord => {
  const rec = records.get(name)
  if (!rec) throw new Error(`Capability "${name}" not found`)
  if (!rec.enabled) return rec
  const next: CapabilityRecord = { ...rec, enabled: false }
  records.set(name, next)
  emit(next, "disable")
  return next
}

const get = (name: string): CapabilityRecord | undefined => records.get(name)

const list = (filter: ListFilter = {}): ReadonlyArray<CapabilityRecord> => {
  let out = Array.from(records.values())
  if (filter.source !== undefined) {
    out = out.filter((r) => r.manifest.metadata.source === filter.source)
  }
  if (filter.enabled !== undefined) {
    out = out.filter((r) => r.enabled === filter.enabled)
  }
  out.sort((a, b) => {
    const oa = orderOf(a.manifest)
    const ob = orderOf(b.manifest)
    if (oa !== ob) return oa - ob
    return a.manifest.metadata.name.localeCompare(b.manifest.metadata.name)
  })
  return out
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Test-only helper: clear the registry. Production code never calls this.
 */
const resetForTest = (): void => {
  records.clear()
  listeners.clear()
}

export const capabilityRegistry = {
  install,
  installFromYaml,
  uninstall,
  enable,
  disable,
  get,
  list,
  subscribe,
  /** @internal — tests only. */
  resetForTest,
} as const

export type CapabilityRegistry = typeof capabilityRegistry
