/**
 * Agent Service — frontend-side wrapper that forwards user chats to the
 * platform's Effect-based Agent Runtime (Phase B).
 *
 * Design notes (Phase B Task 7.3):
 *
 *   - **Single mode.** The Tauri IPC bridge for agent commands
 *     (agent_chat / agent_chat_stream / agent_runtime_init /
 *     agent_list_skills / agent_list_mcp_tools) has been removed in
 *     Task 7.1. All chat now goes through `window.__platform.runtime`
 *     which is the Effect-based PlatformRuntime bootstrapped in main.tsx.
 *
 *   - **Mock fallback.** When `window.__platform` is not yet available
 *     (browser dev before bootstrap, or unit tests that don't call
 *     bootstrapPlatform), all calls fall through to deterministic mock
 *     implementations. This keeps the UI usable during development and
 *     keeps unit tests fast.
 *
 *   - **Stream delivery.** `chatWithStream` drives an Effect Stream via
 *     `Session.Service.run({ onEvent })`. Events are delivered
 *     synchronously inside the Effect runtime — no Tauri event channel
 *     subscription is needed. `subscribeToStream` / `unsubscribeFromStream`
 *     are kept as no-ops for backward compatibility with call sites that
 *     have not yet been updated.
 *
 *   - **Capability contract (arch-capability-agent-contract).**
 *     `chatWithStream` now goes through `resolveCapability(...)` as the
 *     single source of truth for `agentName`. `request.agentName` is
 *     deprecated — it survives only for compile-time compatibility and
 *     emits a console.warn if supplied. Callers must pass `capabilityId`.
 *
 * // TODO(arch-runtime-reliability-guards): move withTimeout into
 *     Session.run so the Service layer no longer owns reliability.
 */

import { Effect } from "effect"
import { Agent } from "@/agent-runtime/agent/agent"
import { Skill } from "@/agent-runtime/skill/index"
import { Session } from "@/agent-runtime/session/session"
import { getPlatformRuntime } from "@/platform/bootstrap"
import {
  resolveCapability,
  type ResolvedCapability,
} from "@/platform/registry"
import { useAIStore, type AIModelConfig } from "@/stores/aiStore"
import { buildSystemPrompt } from "@/services/contextBuilder"
import { record as recordMetric } from "@/services/metricsService"

// ─── Types ───────────────────────────────────────────────────────────

export interface AgentChatRequest {
  readonly sessionID: string
  readonly message: string
  /**
   * @deprecated Use `capabilityId` instead. Kept for back-compat with old
   * test fixtures; supplying it produces a console.warn and is ignored at
   * runtime — Agent selection always goes through `resolveCapability`.
   */
  readonly agentName?: string
  readonly capabilityId?: string
  /** Absolute path to the current workspace root. Injected into the capability's entryPrompt via {{workspacePath}}. */
  readonly workspacePath?: string
}

export interface AgentChatResponse {
  readonly sessionID: string
  readonly messageID: string
  readonly content: string
  readonly finishReason: "stop" | "length" | "tool_use" | "error"
}

export interface AgentStreamEvent {
  readonly type: "text-delta" | "tool-call" | "tool-result" | "finish" | "error"
  readonly sessionID: string
  readonly messageID: string
  readonly text?: string
  readonly toolName?: string
  readonly toolArgs?: Record<string, unknown>
  readonly toolResult?: unknown
  readonly reason?: AgentChatResponse["finishReason"]
  readonly error?: string
}

export interface AgentSkillInfo {
  readonly name: string
  readonly description: string
  readonly agent: string
  readonly parameters: Record<string, unknown>
}

export interface AgentMCPToolInfo {
  readonly name: string
  readonly description: string
  readonly serverName: string
  readonly parameters: Record<string, unknown>
}

// ─── ID helpers ──────────────────────────────────────────────────────

let messageCounter = 0
const newMessageID = (): string => {
  messageCounter += 1
  return `msg-${Date.now()}-${messageCounter}`
}

/**
 * Warn-once for the deprecated `request.agentName` field. We do not
 * gate behaviour on it any more — resolveCapability is the single source
 * of truth — but we keep the warn so downstream still notices.
 */
const warnDeprecatedAgentName = (req: AgentChatRequest): void => {
  if (req.agentName !== undefined) {
    // eslint-disable-next-line no-console
    console.warn(
      "[agentService] AgentChatRequest.agentName is deprecated and ignored; " +
        "agentName is derived from capabilityId via resolveCapability().",
    )
  }
}

const AGENT_STREAM_TIMEOUT_MS = 90_000

const withTimeout = async <T,>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Agent response timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ─── Mock responses ──────────────────────────────────────────────────

const mockResponseFor = (agentName: string | undefined): string => {
  if (agentName === "screener") {
    return "好的，我是简历筛选专家小七。请提供 JD 或要求，我帮你逐份筛选候选人简历。"
  }
  if (agentName === "compliance") {
    return "好的，我是合规检查小七。我会扫描 JD 是否含歧视性表述，并标记简历中的 PII。"
  }
  return "你好，我是小七。你可以告诉我想做什么，比如筛选简历、生成面试提纲，我来帮你完成。"
}

// ─── chatWithAgent ───────────────────────────────────────────────────

export async function chatWithAgent(
  request: AgentChatRequest,
): Promise<AgentChatResponse> {
  warnDeprecatedAgentName(request)
  const runtime = getPlatformRuntime()
  // Best-effort agentName resolution for chatWithAgent — this entry
  // point predates the capability contract and still has callers that
  // pass `agentName` directly (debug tooling, legacy tests). For the
  // strict contract path see `chatWithStream` below.
  let agentName: string | undefined
  if (request.capabilityId) {
    agentName = resolveCapability(request.capabilityId).agentName
  } else if (request.agentName) {
    agentName = request.agentName
  }
  if (runtime) {
    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const sessionSvc = yield* Session.Service
          const sessionInfo = yield* sessionSvc.create(agentName)
          const runResult = yield* sessionSvc.run(sessionInfo.id, {
            message: request.message,
            agentName,
          })
          return runResult
        }),
      )
      // SessionRunResult.content is ContentPart[] — extract text parts.
      const textContent = result.content
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join("")
      return {
        sessionID: request.sessionID,
        messageID: result.messageID,
        content: textContent || JSON.stringify(result.content),
        finishReason: "stop",
      }
    } catch (e) {
      throw new Error(
        `Agent chat failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  // Mock fallback
  return {
    sessionID: request.sessionID,
    messageID: newMessageID(),
    content: mockResponseFor(agentName),
    finishReason: "stop",
  }
}

// ─── chatWithStream ──────────────────────────────────────────────────

export async function chatWithStream(
  request: AgentChatRequest,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<void> {
  warnDeprecatedAgentName(request)

  // Capability contract: resolver is the single source of truth for
  // agentName. If capabilityId is missing / unknown / disabled, the
  // resolver throws — we surface that to the caller via the `error`
  // event so the store layer's withStreaming finally can run.
  let resolved: ResolvedCapability
  try {
    resolved = resolveCapability(request.capabilityId as string)
  } catch (e) {
    onEvent({
      type: "error",
      sessionID: request.sessionID,
      messageID: newMessageID(),
      error: e instanceof Error ? e.message : String(e),
    })
    return
  }
  const agentName = resolved.agentName

  const runtime = getPlatformRuntime()
  if (runtime) {
    try {
      const messageID = newMessageID()
      const systemPrompt = buildSystemPrompt(resolved.capabilityId, {
        workspacePath: request.workspacePath,
      })
      // Prepend systemPrompt to the message so Session.Service.run receives
      // the capability context. Phase E will extend Session.Service.run to
      // accept a dedicated systemPrompt parameter.
      const messageWithSystem = systemPrompt
        ? `[System: ${systemPrompt}]\n\n${request.message}`
        : request.message
      const sessionInfo = await runtime.runPromise(
        Effect.gen(function* () {
          const sessionSvc = yield* Session.Service
          return yield* sessionSvc.create(agentName)
        }),
      )
      try {
        await withTimeout(
          runtime.runPromise(
            Effect.gen(function* () {
              const sessionSvc = yield* Session.Service
              yield* sessionSvc.run(sessionInfo.id, {
                message: messageWithSystem,
                agentName,
                onEvent: (evt) => {
                  // ProcessorEvent carries a discriminated `data` field.
                  const d = evt.data
                  if (d.type === "text-delta") {
                    onEvent({
                      type: "text-delta",
                      sessionID: request.sessionID,
                      messageID,
                      text: d.text,
                    })
                  } else if (d.type === "tool-start") {
                    onEvent({
                      type: "tool-call",
                      sessionID: request.sessionID,
                      messageID,
                      toolName: d.toolName,
                      toolArgs: d.input,
                    })
                  } else if (d.type === "tool-complete") {
                    onEvent({
                      type: "tool-result",
                      sessionID: request.sessionID,
                      messageID,
                      toolResult: d.result,
                    })
                  } else if (d.type === "tool-error") {
                    onEvent({
                      type: "tool-result",
                      sessionID: request.sessionID,
                      messageID,
                      toolResult: d.error,
                      error: d.error,
                    })
                  } else if (d.type === "finish") {
                    onEvent({
                      type: "finish",
                      sessionID: request.sessionID,
                      messageID,
                      reason: "stop",
                    })
                    recordMetric({
                      type: "token-usage",
                      sessionId: request.sessionID,
                      capabilityId: resolved.capabilityId,
                      timestamp: Date.now(),
                    })
                  }
                },
              })
            }),
          ),
          AGENT_STREAM_TIMEOUT_MS,
        )
      } catch (e) {
        await runtime.runPromise(
          Effect.gen(function* () {
            const sessionSvc = yield* Session.Service
            yield* sessionSvc.abort(sessionInfo.id)
          }),
        ).catch(() => undefined)
        throw e
      }
      return
    } catch (e) {
      onEvent({
        type: "error",
        sessionID: request.sessionID,
        messageID: newMessageID(),
        error: e instanceof Error ? e.message : String(e),
      })
      return
    }
  }

  // Mock streaming: chunk the response into 4-char pieces with small delays.
  const messageID = newMessageID()
  const text = mockResponseFor(agentName)
  const chunkSize = 4
  for (let i = 0; i < text.length; i += chunkSize) {
    onEvent({
      type: "text-delta",
      sessionID: request.sessionID,
      messageID,
      text: text.slice(i, i + chunkSize),
    })
    await new Promise((r) => setTimeout(r, 8))
  }
  onEvent({
    type: "finish",
    sessionID: request.sessionID,
    messageID,
    reason: "stop",
  })
}

// ─── chatWithoutCapability (debug / test only) ───────────────────────

/**
 * @internal Debug-only entry point that bypasses the capability
 * contract. Intended for dev tooling / unit tests where exercising the
 * Session runtime without a registered Capability is useful.
 *
 * **Do not import from `src/components/`** — production code paths must
 * go through `chatWithStream` so they remain bound to the contract.
 */
export async function chatWithoutCapability(
  message: string,
  opts: { agentName?: string; sessionID?: string } = {},
): Promise<AgentChatResponse> {
  const sessionID = opts.sessionID ?? `session-debug-${Date.now()}`
  const runtime = getPlatformRuntime()
  if (runtime) {
    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const sessionSvc = yield* Session.Service
          const sessionInfo = yield* sessionSvc.create(opts.agentName)
          return yield* sessionSvc.run(sessionInfo.id, {
            message,
            agentName: opts.agentName,
          })
        }),
      )
      const textContent = result.content
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join("")
      return {
        sessionID,
        messageID: result.messageID,
        content: textContent || JSON.stringify(result.content),
        finishReason: "stop",
      }
    } catch (e) {
      throw new Error(
        `Debug chat failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  return {
    sessionID,
    messageID: newMessageID(),
    content: mockResponseFor(opts.agentName),
    finishReason: "stop",
  }
}

// ─── listSkills ──────────────────────────────────────────────────────

export async function listSkills(): Promise<AgentSkillInfo[]> {
  const runtime = getPlatformRuntime()
  if (runtime) {
    try {
      const skills = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* Skill.Service
          return yield* svc.all()
        }),
      )
      return skills.map((s) => ({
        name: s.name,
        description: s.description ?? "",
        agent: "", // Skill.Info has no agentName field; agent association is via manifest
        parameters: {},
      }))
    } catch {
      // fall through to mock
    }
  }
  return [
    {
      name: "screen_resumes",
      description: "Screen candidate resumes against a job description",
      agent: "screener",
      parameters: {
        type: "object",
        properties: {
          jdContent: { type: "string" },
          resumes: { type: "array" },
        },
      },
    },
    {
      name: "compliance_check",
      description: "Check JD for discriminatory language and resumes for PII",
      agent: "compliance",
      parameters: {
        type: "object",
        properties: { content: { type: "string" } },
      },
    },
  ]
}

// ─── listMCPTools ────────────────────────────────────────────────────

export async function listMCPTools(): Promise<AgentMCPToolInfo[]> {
  const runtime = getPlatformRuntime()
  if (runtime) {
    try {
      const agents = await runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* Agent.Service
          return yield* svc.list()
        }),
      )
      // Flatten each agent's allowed tools into a pseudo-MCP tool list.
      return agents.flatMap((a) =>
        (a.tools ?? []).map((toolName: string) => ({
          name: toolName,
          description: `Tool exposed by agent ${a.name}`,
          serverName: a.name,
          parameters: { type: "object", properties: {} },
        })),
      )
    } catch {
      // fall through to mock
    }
  }
  return [
    {
      name: "list_projects",
      description: "List all HR projects in the workspace",
      serverName: "hr-internal",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "get_resume",
      description: "Read a candidate resume",
      serverName: "hr-internal",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
      },
    },
  ]
}

// ─── initRuntime ─────────────────────────────────────────────────────

/**
 * Update the aiStore connection status.
 *
 * Phase B: `bootstrapPlatform()` in main.tsx is the single source of
 * truth for runtime initialisation. This function only reflects the
 * outcome in the store so the UI can react to it. The `config` parameter
 * is accepted for backward compatibility but is no longer used to
 * construct a new runtime — that is bootstrap's job.
 */
export async function initRuntime(_config?: AIModelConfig): Promise<void> {
  useAIStore.getState().setConnectionStatus("connected")
}

// ─── Stream subscription bookkeeping (no-op stubs) ───────────────────

/**
 * No-op. Phase B streams are delivered inline via `chatWithStream`'s
 * `onEvent` callback — no separate Tauri event channel subscription is
 * needed. Kept for backward compatibility with call sites that have not
 * yet been updated.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function subscribeToStream(
  _sessionID: string,
  _onEvent: (event: AgentStreamEvent) => void,
): Promise<void> {
  // intentional no-op
}

/**
 * No-op. See `subscribeToStream`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function unsubscribeFromStream(_sessionID: string): Promise<void> {
  // intentional no-op
}

// ─── Phase G: Session lifecycle extensions ───────────────────────────

import type { SessionMetadata, SessionState as SessionLifecycleState } from "@/agent-runtime/session/session"

export type { SessionMetadata, SessionLifecycleState }

export interface StartSessionOptions {
  readonly parentSessionId?: string | null
  readonly delegateDepth?: number
  readonly transferredFrom?: {
    readonly capability: string
    readonly summary: string
  } | null
  readonly metadata?: Partial<SessionMetadata>
}

/** Internal session state tracking for pause/resume/transfer. */
interface ManagedSession {
  readonly sessionId: string
  readonly agentName: string
  state: SessionLifecycleState
  metadata: SessionMetadata
  transcripts: Array<{ role: string; content: string; timestamp: number }>
}

const managedSessions = new Map<string, ManagedSession>()

/**
 * Start a new session for the given agent, with optional parent/delegate metadata.
 *
 * This is the Phase G entry point for creating sessions with lifecycle tracking.
 * Unlike `chatWithStream` (which creates ephemeral sessions), `startSession`
 * registers the session in `managedSessions` for pause/resume/transfer support.
 */
export async function startSession(
  agentName: string,
  options: StartSessionOptions = {},
): Promise<{ sessionId: string; agentName: string }> {
  if (!agentName || agentName.trim().length === 0) {
    throw new Error("START_SESSION_AGENT_REQUIRED: agentName must be a non-empty string")
  }

  const runtime = getPlatformRuntime()
  let sessionId: string

  if (runtime) {
    const sessionInfo = await runtime.runPromise(
      Effect.gen(function* () {
        const sessionSvc = yield* Session.Service
        return yield* sessionSvc.create(agentName)
      }),
    )
    sessionId = sessionInfo.id
  } else {
    // Mock fallback for tests
    sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  const metadata: SessionMetadata = {
    parentSessionId: options.parentSessionId ?? options.metadata?.parentSessionId ?? null,
    delegateDepth: options.delegateDepth ?? options.metadata?.delegateDepth ?? 0,
    transferredFrom: options.transferredFrom ?? options.metadata?.transferredFrom ?? null,
    wecomUserId: options.metadata?.wecomUserId,
  }

  managedSessions.set(sessionId, {
    sessionId,
    agentName,
    state: "active",
    metadata,
    transcripts: [],
  })

  return { sessionId, agentName }
}

/**
 * Transfer context (recent transcripts summary) from one session to another.
 *
 * Design (D3): shallow-copy last N messages as summary; does NOT share workspace.
 */
export async function transferContext(
  fromSessionId: string,
  toSessionId: string,
  options: { lastNMessages?: number } = {},
): Promise<void> {
  const lastN = options.lastNMessages ?? 5

  const fromSession = managedSessions.get(fromSessionId)
  if (!fromSession) {
    throw new Error(`TRANSFER_SOURCE_NOT_FOUND: session "${fromSessionId}" not found in managed sessions`)
  }

  const toSession = managedSessions.get(toSessionId)
  if (!toSession) {
    throw new Error(`TRANSFER_TARGET_NOT_FOUND: session "${toSessionId}" not found in managed sessions`)
  }

  // Take the last N transcripts from the source session
  const recentTranscripts = fromSession.transcripts.slice(-lastN)
  const summary = recentTranscripts
    .map((t) => `[${t.role}]: ${t.content.slice(0, 200)}`)
    .join("\n")

  toSession.metadata = {
    ...toSession.metadata,
    transferredFrom: {
      capability: fromSession.agentName,
      summary,
    },
  }
}

/**
 * Pause a session (used during silent switch to preserve the original session).
 *
 * Design (D4): paused sessions can be resumed within the Toast undo window.
 */
export async function pauseSession(sessionId: string): Promise<void> {
  const session = managedSessions.get(sessionId)
  if (!session) {
    throw new Error(`PAUSE_SESSION_NOT_FOUND: session "${sessionId}" not found`)
  }
  if (session.state === "ended") {
    throw new Error(`PAUSE_SESSION_ALREADY_ENDED: session "${sessionId}" has already ended`)
  }
  session.state = "paused"
}

/**
 * Resume a previously paused session.
 *
 * Design (D4): only paused sessions can be resumed; ended sessions throw.
 */
export async function resumeSession(sessionId: string): Promise<void> {
  const session = managedSessions.get(sessionId)
  if (!session) {
    throw new Error(`RESUME_SESSION_NOT_FOUND: session "${sessionId}" not found`)
  }
  if (session.state === "ended") {
    throw new Error(`RESUME_SESSION_ALREADY_ENDED: session "${sessionId}" has already ended and cannot be resumed`)
  }
  if (session.state !== "paused") {
    throw new Error(`RESUME_SESSION_NOT_PAUSED: session "${sessionId}" is "${session.state}", not "paused"`)
  }
  session.state = "active"
}

/**
 * End a session permanently. Cannot be resumed after this.
 */
export async function endSession(
  sessionId: string,
  reason?: string,
): Promise<void> {
  const session = managedSessions.get(sessionId)
  if (!session) {
    throw new Error(`END_SESSION_NOT_FOUND: session "${sessionId}" not found`)
  }
  session.state = "ended"

  // Also abort the underlying Effect session if runtime is available
  const runtime = getPlatformRuntime()
  if (runtime) {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sessionSvc = yield* Session.Service
        yield* sessionSvc.abort(sessionId)
      }),
    ).catch(() => undefined) // best-effort
  }

  if (reason) {
    recordMetric({
      type: "session-ended",
      sessionId,
      reason,
      timestamp: Date.now(),
    } as never)
  }
}

/**
 * Get a managed session's info. Returns undefined if not found.
 */
export function getManagedSession(sessionId: string): ManagedSession | undefined {
  return managedSessions.get(sessionId)
}

/**
 * Append a transcript entry to a managed session (called by stream handlers).
 */
export function appendTranscript(
  sessionId: string,
  role: string,
  content: string,
): void {
  const session = managedSessions.get(sessionId)
  if (session) {
    session.transcripts.push({ role, content, timestamp: Date.now() })
  }
}

/** @internal — tests only. */
export function clearManagedSessionsForTest(): void {
  managedSessions.clear()
}
