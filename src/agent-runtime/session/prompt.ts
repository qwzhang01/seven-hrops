import { Effect, Layer, Context, Stream, Schema } from "effect"
import { Agent, type Info as AgentInfo } from "../agent/agent"
import { ToolRuntime, type ToolDefinition, type ModelMessage, type ModelAdapter, type LLMStreamEvent, type ContentPart } from "../agent/tool-runtime"
import { SessionProcessor, type ProcessorEvent, type ProcessorEventHandler, type ProcessorResult } from "./processor"

/**
 * Session Prompt — The main entry point for Agent conversations.
 *
 * Adapted from OpenCode's prompt.ts (1909 lines) — drastically simplified:
 * - Removed: Title generation, Plan mode, Instruction system, Compaction,
 *   Compaction agent, Structured output, File attachments, System prompt
 *   resolution from files, Session revert, Max steps reminders
 * - Kept: Core prompt → loop → result pipeline
 * - Simplified: Direct tool resolution instead of ToolRegistry + MCP merge
 *
 * Usage:
 * ```ts
 * const result = await SessionPrompt.run({
 *   sessionID: "session-1",
 *   message: "Screen all resumes for the Frontend Engineer position",
 *   agentName: "screener",
 *   tools: [...],
 *   model: myModelAdapter,
 *   onEvent: (event) => updateUI(event),
 * })
 * ```
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface PromptInput {
  readonly sessionID: string
  readonly message: string
  readonly agentName?: string
  readonly tools: ReadonlyArray<ToolDefinition>
  readonly model: ModelAdapter
  readonly maxSteps?: number
  readonly systemPrompt?: string
  readonly temperature?: number
  readonly onEvent?: ProcessorEventHandler
  readonly history?: ReadonlyArray<ModelMessage>
}

export interface PromptResult {
  readonly sessionID: string
  readonly messageID: string
  readonly content: ContentPart[]
  readonly finishReason: string
  readonly error?: string
}

// ─── Service ─────────────────────────────────────────────────────────

export interface Interface {
  readonly run: (input: PromptInput) => Effect.Effect<PromptResult, Error>
}

export class Service extends Context.Service<Service, Interface>()("@agent-runtime/SessionPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agentService = yield* Agent.Service
    const processorService = yield* SessionProcessor.Service

    const run = Effect.fn("SessionPrompt.run")(function* (input: PromptInput) {
      // Resolve agent
      const agentName = input.agentName ?? (yield* agentService.defaultAgent())
      const agent = yield* agentService.get(agentName)

      // Build messages
      const messages: ModelMessage[] = [
        ...(input.history ?? []),
        { role: "user" as const, content: input.message },
      ]

      // Determine system prompt
      const systemPrompt = input.systemPrompt ?? agent.prompt ?? `You are ${agent.name}. ${agent.description ?? ""}`

      // Determine temperature
      const temperature = input.temperature ?? agent.temperature ?? 0.7

      // Filter tools based on agent's allowed tools
      const agentTools = input.tools.filter((tool) => {
        if (!agent.tools) return true
        return agent.tools.includes(tool.name)
      })

      // Max steps with safety cap
      const maxSteps = Math.min(input.maxSteps ?? 50, 100)

      // Create a unique message ID
      const messageID = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      // Track event history for debugging / replay
      const eventHistory: ProcessorEvent[] = []
      const wrappedOnEvent: ProcessorEventHandler = (event) => {
        eventHistory.push(event)
        input.onEvent?.(event)
      }

      // Create processor handle
      const processor = yield* processorService.create({
        sessionID: input.sessionID,
        messageID,
        agentName,
        onEvent: wrappedOnEvent,
      })

      // Run the tool loop
      const stream = ToolRuntime.stream({
        messages,
        tools: agentTools,
        model: input.model,
        maxSteps,
        systemPrompt,
        temperature,
      })

      const result = yield* processor.process(stream)

      // Add max steps warning if the agent hit the limit
      if (result.finishReason === "max-steps" && eventHistory.length > 0) {
        wrappedOnEvent({
          type: "text-delta",
          sessionID: input.sessionID,
          messageID,
          data: {
            type: "text-delta",
            text: "\n\n⚠️ Agent reached the maximum number of steps. The task may be incomplete.",
          },
        })
      }

      return {
        sessionID: input.sessionID,
        messageID,
        content: result.assistantContent,
        finishReason: result.finishReason,
        error: result.error,
      } satisfies PromptResult
    })

    return Service.of({ run })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Agent.defaultLayer),
  Layer.provide(SessionProcessor.defaultLayer),
)

export const SessionPrompt = { Service, defaultLayer, layer }
