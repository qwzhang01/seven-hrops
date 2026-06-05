/**
 * Public re-exports for the platform registry layer.
 *
 * Service / Store / Component code SHOULD import from here, not from
 * the individual implementation files, so the resolver / registry split
 * remains a single barrel.
 */

export {
  capabilityRegistry,
  type CapabilityRecord,
  type Source,
  type Action,
  type SubscriptionEvent,
  type Listener,
  type ListFilter,
  type InstallOptions,
} from "./capabilityRegistry"

export {
  resolveCapability,
  CapabilityNotFoundError,
  CapabilityDisabledError,
  type ResolvedCapability,
} from "./capabilityResolver"

export { toolRegistry } from "./toolRegistry"
