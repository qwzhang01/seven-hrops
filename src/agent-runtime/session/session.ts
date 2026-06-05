import { Effect, Layer, Context, Fiber } from "effect"
import type { ModelMessage, ContentPart } from "../agent/tool-runtime"
import { Config } from "../config/index"
import { Provider } from "../provider/index"
import { MCP } from "../mcp/index"
import { SessionPrompt, type PromptInput, type PromptResult } from "./prompt"
import { SessionProcessor, type ProcessorEvent, type ProcessorEventHandler } from "./processor"
import { Agent, type Info as AgentInfo } from "../agent/agent"
import { toolRegistry } from "@/platform/registry/toolRegistry"

/**
 * Session — High-level conversation session management.
 *
 * Wraps SessionPrompt and adds:
 * - Message history tracking
 * - MCP tool discovery and injection
 * - Model adapter resolution
 * - Session lifecycle (create, run, abort)
 *
 * This is the primary API surface that the Tauri frontend will interact with.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface SessionMessage {
  readonly id: string
  readonly role: "user" | "assistant" | "system"
  readonly content: string | ContentPart[]
  readonly timestamp: number
  readonly agentName?: string
  readonly error?: string
}

export type SessionState = "active" | "paused" | "ended"

export interface SessionMetadata {
  readonly parentSessionId?: string | null
  readonly delegateDepth?: number
  readonly transferredFrom?: {
    readonly capability: string
    readonly summary: string
  } | null
  readonly wecomUserId?: string
}

export interface SessionInfo {
  readonly id: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly messageCount: number
  readonly agentName: string
  readonly state: SessionState
  readonly metadata: SessionMetadata
  /**
   * Optional workspace bound to this session.
   * Set when the capability declares `needsWorkspace: true`.
   * Undefined for pure-chat sessions (e.g. assistant, music-radio).
   * See: openspec/changes/use_def/session-workspace-binding
   */
  readonly workspaceId?: string
}

export interface SessionRunOptions {
  readonly message: string
  /**
   * Only set this when you want to **switch** the active Agent partway
   * through a session. When omitted, `Session.run` falls back to the
   * `agentName` captured at `Session.create` time.
   *
   * Implementations MUST treat the resolved `runAgentName` as an
   * invariant — if it ends up falsy (empty / undefined) `Session.run`
   * SHALL throw `SessionAgentMismatchError`. See
   * `openspec/changes/arch-capability-agent-contract/specs/agent-runtime-session/spec.md`.
   */
  readonly agentName?: string
  readonly maxSteps?: number
  readonly temperature?: number
  readonly systemPrompt?: string
  readonly onEvent?: ProcessorEventHandler
}

export interface SessionRunResult {
  readonly sessionID: string
  readonly messageID: string
  readonly content: ContentPart[]
  readonly finishReason: string
  readonly error?: string
}

// ─── Service ─────────────────────────────────────────────────────────

export interface Interface {
  readonly create: (agentName?: string) => Effect.Effect<SessionInfo>
  readonly run: (sessionID: string, options: SessionRunOptions) => Effect.Effect<SessionRunResult, Error>
  readonly getHistory: (sessionID: string) => Effect.Effect<SessionMessage[]>
  readonly abort: (sessionID: string) => Effect.Effect<void>
  readonly list: () => Effect.Effect<SessionInfo[]>
}

export class Service extends Context.Service<Service, Interface>()("@agent-runtime/Session") {}

// ─── Errors ──────────────────────────────────────────────────────────

/**
 * Thrown by `Session.run` when the resolved `runAgentName` is falsy.
 * In practice this should be unreachable because `Session.create`
 * already guarantees `state.info.agentName` is non-empty — the throw
 * exists as an explicit invariant so contract violations fail loudly
 * instead of silently calling `configService.getModel("")`.
 */
export class SessionAgentMismatchError extends Error {
  readonly code = "SESSION_AGENT_MISMATCH"
  readonly sessionID: string
  constructor(sessionID: string, detail?: string) {
    super(
      `Session "${sessionID}" is not bound to any agent${
        detail ? ` (${detail})` : ""
      }`,
    )
    this.name = "SessionAgentMismatchError"
    this.sessionID = sessionID
  }
}

// ─── Implementation ──────────────────────────────────────────────────

interface MutableSessionInfo {
  id: string
  createdAt: number
  updatedAt: number
  messageCount: number
  agentName: string
  state: SessionState
  metadata: SessionMetadata
}

interface InternalSessionState {
  info: MutableSessionInfo
  messages: SessionMessage[]
  activeFiber?: Fiber.Fiber<PromptResult, Error>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const configService = yield* Config.Service
    const providerService = yield* Provider.Service
    const mcpService = yield* MCP.Service
    const agentService = yield* Agent.Service
    const promptService = yield* SessionPrompt.Service
    const processorService = yield* SessionProcessor.Service

    const sessions = new Map<string, InternalSessionState>()

    const create = Effect.fn("Session.create")(function* (agentName?: string) {
      const name = agentName ?? (yield* agentService.defaultAgent())
      const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const now = Date.now()

      const state: InternalSessionState = {
        info: { id, createdAt: now, updatedAt: now, messageCount: 0, agentName: name, state: "active", metadata: {} },
        messages: [],
      }

      sessions.set(id, state)
      return state.info
    })

    const run = Effect.fn("Session.run")(function* (sessionID: string, options: SessionRunOptions) {
      const state = sessions.get(sessionID)
      if (!state) throw new Error(`Session "${sessionID}" not found`)
      const runAgentName = options.agentName ?? state.info.agentName
      // Invariant: runAgentName must be a non-empty string. create()
      // already guarantees state.info.agentName is set (it falls back to
      // agentService.defaultAgent()), so this branch only fires for
      // pathological mocked states. Throwing surfaces contract bugs
      // instead of letting an empty string flow into provider lookups.
      if (!runAgentName) {
        throw new SessionAgentMismatchError(
          sessionID,
          "options.agentName and state.info.agentName are both empty",
        )
      }

      // Add user message to history
      const userMessageID = `msg-${Date.now()}-user`
      state.messages.push({
        id: userMessageID,
        role: "user",
        content: options.message,
        timestamp: Date.now(),
        agentName: runAgentName,
      })

      // Resolve model adapter
      const modelConfig = yield* configService.getModel(runAgentName)
      const modelAdapter = yield* providerService.createModelAdapter(modelConfig)

      // Register sandbox session so platform tools (fs / parse / export) can pass
      // the fs_guard check.
      //
      // Architectural contract (跨层契约纪律 §sandbox-lifecycle):
      //   Any caller of toolRegistry.toToolDefinitions() MUST call
      //   toolRegistry.createSandboxSession() before the first tool invocation,
      //   and MUST call toolRegistry.dropSandboxSession() in a finally block.
      //   See toolRegistry.ts for the full contract documentation.
      yield* Effect.promise(() => toolRegistry.createSandboxSession(sessionID))

      // Collect tools from MCP + built-in
      const mcpTools = yield* mcpService.tools()
      const builtInTools = createBuiltInTools(sessionID)

      // Convert history to ModelMessage format
      // Exclude the current user message (just pushed above) — prompt.ts will add it.
      // Also exclude system messages (AI SDK expects system prompt via the `system` param, not in messages[]).
      const history: ModelMessage[] = state.messages
        .slice(0, -1)
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({
          role: msg.role as "user" | "assistant" | "tool",
          content: typeof msg.content === "string" ? msg.content : msg.content,
        }))

      // Run the prompt in a forked fiber so we can interrupt it on abort.
      const fiber = yield* Effect.forkChild(promptService.run({
        sessionID,
        message: options.message,
        agentName: runAgentName,
        tools: [...mcpTools, ...builtInTools],
        model: modelAdapter,
        maxSteps: options.maxSteps,
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
        onEvent: options.onEvent,
        history,
      }))

      // Store the fiber reference for abort support
      state.activeFiber = fiber

      // Await the result (this will throw if the fiber is interrupted)
      let result: PromptResult
      try {
        result = yield* Fiber.join(fiber)
      } finally {
        // Drop the sandbox session regardless of success / failure / abort.
        // Fulfils the §sandbox-lifecycle contract: createSandboxSession ↔ dropSandboxSession.
        void toolRegistry.dropSandboxSession(sessionID)
      }

      // Add assistant message to history
      state.messages.push({
        id: result.messageID,
        role: "assistant",
        content: result.content,
        timestamp: Date.now(),
        agentName: runAgentName,
        error: result.error,
      })

      state.info.updatedAt = Date.now()
      state.info.messageCount = state.messages.length

      // Clear the fiber reference — the run has completed
      state.activeFiber = undefined

      return {
        sessionID: result.sessionID,
        messageID: result.messageID,
        content: result.content,
        finishReason: result.finishReason,
        error: result.error,
      } satisfies SessionRunResult
    })

    const getHistory = Effect.fn("Session.getHistory")(function* (sessionID: string) {
      const state = sessions.get(sessionID)
      if (!state) throw new Error(`Session "${sessionID}" not found`)
      return [...state.messages]
    })

    const abort = Effect.fn("Session.abort")(function* (sessionID: string) {
      const state = sessions.get(sessionID)
      if (!state?.activeFiber) return
      yield* Fiber.interrupt(state.activeFiber)
      state.activeFiber = undefined
    })

    const list = Effect.fn("Session.list")(function* () {
      return Array.from(sessions.values()).map((s) => s.info)
    })

    return Service.of({ create, run, getHistory, abort, list })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(MCP.defaultLayer),
  Layer.provide(Agent.defaultLayer),
  Layer.provide(SessionPrompt.defaultLayer),
  Layer.provide(SessionProcessor.defaultLayer),
)

export const Session = { Service, defaultLayer, layer }

// ─── Built-in Tools ──────────────────────────────────────────────────

/**
 * Create built-in tools that are always available to agents.
 * These tools provide basic interaction capabilities without requiring MCP servers.
 *
 * NOTE (arch-runtime-single-loop):
 *   The `execute` functions below are invoked by `ToolRuntime.dispatch`,
 *   NEVER by the AI SDK. The Provider layer passes only declarations
 *   (description + inputSchema) to `streamText`, so AI SDK emits raw
 *   `tool-call` events without ever touching these handlers.
 *
 * NOTE (single source of truth):
 *   Platform tools (fs / parse / export / etc.) are NOT defined here.
 *   Their parameter schemas live in `_registry.ts` (TOOL_REGISTRY) and are
 *   converted to `ToolDefinition[]` via `toolRegistry.toToolDefinitions()`.
 *   Adding a new platform tool: add it to `_registry.ts` + its toolpack invoker.
 *   Do NOT add it here.
 */
function createBuiltInTools(sessionID: string): import("../agent/tool-runtime").ToolDefinition[] {
  // ── Interaction tools (Agent-layer only, no toolRegistry counterpart) ──
  const interactionTools: import("../agent/tool-runtime").ToolDefinition[] = [
    {
      name: "chat",
      description: "Send a chat message to the user and receive their reply. Use this to ask clarifying questions or present information.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to send to the user",
          },
        },
        required: ["message"],
      },
      execute: async (args) => {
        return { type: "chat_response", message: args.message as string }
      },
    },
    {
      name: "think",
      description: "Use this tool to think through complex problems step by step. Your thoughts will not be shown to the user directly, but help you reason more carefully.",
      parameters: {
        type: "object",
        properties: {
          thought: {
            type: "string",
            description: "Your internal reasoning process",
          },
        },
        required: ["thought"],
      },
      execute: async (args) => {
        return { type: "thought", thought: args.thought as string }
      },
    },
  ]

  // ── Platform tools from toolRegistry ──────────────────────────────────
  // Single source of truth: parameter schemas live in _registry.ts (TOOL_REGISTRY).
  // toToolDefinitions() skips tools without `parameters` (internal-only tools like
  // sandbox_create) and handles field-name aliases (e.g. dir_path → path for list_dir).
  const platformTools = toolRegistry.toToolDefinitions(sessionID)

  return [...interactionTools, ...platformTools]
}
