/**
 * system-toolpack — Phase G: activate_capability / delegate_to_subagent are now
 * real implementations. Also exposes models_ensure backed by Rust commands.
 *
 * NOTE: transcribe_audio is registered by parse-toolpack (Phase F Task 2.5).
 *
 * Spec: openspec/changes/assistant-silent-switch/specs/mcp-toolpacks/spec.md
 */

import { z } from "zod"
import type { ToolRegistry } from "@/platform/registry/toolRegistry"
import { InvalidToolArgsError } from "@/types/toolpack"
import { metaOf } from "./_registry"
import { getDispatcher } from "./_dispatcher"

const ModelsEnsure = z.object({
  modelId: z.string().min(1),
})

const ActivateCapability = z.object({
  capabilityId: z.string().min(1),
})

const DelegateToSubagent = z.object({
  agentName: z.string().min(1),
  prompt: z.string().min(1),
})

function parse<T>(name: string, schema: z.ZodSchema<T>, args: unknown): T {
  const r = schema.safeParse(args)
  if (!r.success) {
    throw new InvalidToolArgsError(
      name,
      r.error.issues.map((i) => ({ path: i.path, message: i.message })),
    )
  }
  return r.data
}

export function register(toolRegistry: ToolRegistry): void {
  toolRegistry.register(metaOf("models_ensure"), async (args, ctx) => {
    const a = parse("models_ensure", ModelsEnsure, args)
    return getDispatcher()("models_ensure", {
      sessionId: ctx.sessionId,
      modelId: a.modelId,
    })
  })

  // ── activate_capability (Phase G real implementation) ──────────────────
  toolRegistry.register(metaOf("activate_capability"), async (args, _ctx) => {
    const a = parse("activate_capability", ActivateCapability, args)

    // Dynamic imports to avoid circular dependencies at module load time
    const { capabilityRegistry } = await import("@/platform/registry/capabilityRegistry")
    const { useCapabilityStore } = await import("@/stores/capabilityStore")
    const {
      startSession,
      pauseSession,
      transferContext,
      getManagedSession,
    } = await import("@/services/agentService")

    // Validate target capability exists and is enabled
    const targetRecord = capabilityRegistry.get(a.capabilityId)
    if (!targetRecord) {
      throw new Error(
        `CAPABILITY_NOT_FOUND: capability "${a.capabilityId}" does not exist in the registry`,
      )
    }
    if (!targetRecord.enabled) {
      throw new Error(
        `CAPABILITY_DISABLED: capability "${a.capabilityId}" is disabled`,
      )
    }
    // Reject routing to hidden capabilities (e.g. orchestrator)
    if (targetRecord.manifest.spec.hidden) {
      throw new Error(
        `CAPABILITY_HIDDEN: capability "${a.capabilityId}" is hidden and cannot be activated via routing`,
      )
    }

    // Get current active capability for context transfer
    const store = useCapabilityStore.getState()
    const prevCapabilityId = store.activeCapabilityId

    // Pause the current session if one exists
    // Find the most recent managed session for the current capability
    let prevSessionId: string | null = null
    if (prevCapabilityId && _ctx.sessionId) {
      const prevSession = getManagedSession(_ctx.sessionId)
      if (prevSession && prevSession.state === "active") {
        prevSessionId = _ctx.sessionId
        await pauseSession(_ctx.sessionId)
      }
    }

    // Start a new session for the target capability's agent
    const targetAgentName = targetRecord.manifest.spec.agentName
    const newSession = await startSession(targetAgentName, {
      transferredFrom: prevCapabilityId
        ? { capability: prevCapabilityId, summary: "" }
        : null,
    })

    // Transfer context if we had a previous session
    if (prevSessionId) {
      await transferContext(prevSessionId, newSession.sessionId, { lastNMessages: 5 })
    }

    // Activate the target capability in the store
    store.activateCapability(a.capabilityId)

    // Notify UI for silent switch Toast
    const { useSilentSwitchStore } = await import("@/stores/silentSwitchStore").catch(() => ({
      useSilentSwitchStore: null,
    }))
    if (useSilentSwitchStore) {
      useSilentSwitchStore.getState().setPending({
        fromCapability: prevCapabilityId ?? "",
        fromSessionId: prevSessionId ?? "",
        toCapability: a.capabilityId,
        toSessionId: newSession.sessionId,
      })
    }

    return {
      success: true,
      activatedCapability: a.capabilityId,
      agentName: targetAgentName,
      sessionId: newSession.sessionId,
    }
  })

  // ── delegate_to_subagent (Phase G real implementation) ─────────────────
  toolRegistry.register(metaOf("delegate_to_subagent"), async (args, ctx) => {
    const a = parse("delegate_to_subagent", DelegateToSubagent, args)

    const { startSession, getManagedSession } = await import("@/services/agentService")
    const { capabilityRegistry } = await import("@/platform/registry/capabilityRegistry")

    // Get parent session to check delegate depth
    const parentSession = getManagedSession(ctx.sessionId)
    const parentDepth = parentSession?.metadata.delegateDepth ?? 0

    // Enforce nesting limit (Design D6 in design.md: >= 2 is forbidden)
    if (parentDepth >= 2) {
      throw new Error(
        `DelegateNestingForbidden: delegate depth ${parentDepth + 1} exceeds maximum of 2. ` +
          `Nested delegation is not allowed to prevent infinite loops.`,
      )
    }

    // Enforce cross-source restriction (Design: only builtin → builtin allowed)
    const parentSource = parentSession
      ? (() => {
          // Find the capability record for the parent agent to check source
          const records = capabilityRegistry.list({ enabled: true })
          const parentRecord = records.find(
            (r) => r.manifest.spec.agentName === parentSession.agentName,
          )
          return parentRecord?.source ?? "builtin"
        })()
      : "builtin"

    // Find target agent's source
    const targetRecords = capabilityRegistry.list({ enabled: true })
    const targetRecord = targetRecords.find(
      (r) => r.manifest.spec.agentName === a.agentName,
    )
    const targetSource = targetRecord?.source ?? "user"

    if (parentSource !== targetSource) {
      throw new Error(
        `DelegateCrossSourceForbidden: cannot delegate from source "${parentSource}" to source "${targetSource}". ` +
          `Cross-source delegation is not allowed in this phase.`,
      )
    }

    // Start a child session for the delegate
    const childSession = await startSession(a.agentName, {
      parentSessionId: ctx.sessionId,
      delegateDepth: parentDepth + 1,
    })

    return {
      success: true,
      delegatedTo: a.agentName,
      childSessionId: childSession.sessionId,
      prompt: a.prompt,
    }
  })
}
