import { Effect, Layer, Context, Scope, Deferred, Stream } from "effect"
import type { Agent } from "../agent/agent"
import type { ToolRuntime } from "../agent/tool-runtime"
import type { LLMStreamEvent, ModelMessage, ContentPart } from "../agent/tool-runtime"

/**
 * Session Processor — Handles the streaming lifecycle of an Agent conversation turn.
 *
 * Adapted from OpenCode's processor.ts but drastically simplified for HROps:
 * - Removed: v2 Event system, Snapshot/Patch tracking, Compaction detection,
 *   Doom loop detection, Retry policy, Message Part persistence
 * - Kept: Core streaming event handling, tool call lifecycle, error handling
 * - Added: Simpler event callback model for React state updates
 *
 * The processor takes a stream of LLM events and:
 * 1. Accumulates text content for the assistant message
 * 2. Tracks tool call lifecycle (pending → running → completed/error)
 * 3. Emits events for UI updates
 * 4. Handles interruption (abort)
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface ProcessorEvent {
  type: "text-delta" | "text-complete" | "tool-start" | "tool-complete" | "tool-error" | "finish" | "error"
  sessionID: string
  messageID: string
  data: ProcessorEventData
}

export type ProcessorEventData =
  | { type: "text-delta"; text: string }
  | { type: "text-complete"; text: string }
  | { type: "tool-start"; toolName: string; callID: string; input: Record<string, unknown> }
  | { type: "tool-complete"; callID: string; result: unknown }
  | { type: "tool-error"; callID: string; error: string }
  | { type: "finish"; reason: string }
  | { type: "error"; error: string }

export interface ProcessorResult {
  readonly assistantContent: ContentPart[]
  readonly finishReason: string
  readonly error?: string
}

export type ProcessorEventHandler = (event: ProcessorEvent) => void

export interface ProcessorInput {
  readonly sessionID: string
  readonly messageID: string
  readonly agentName: string
  readonly onEvent?: ProcessorEventHandler
}

export interface Handle {
  readonly process: (stream: Stream.Stream<LLMStreamEvent, Error>) => Effect.Effect<ProcessorResult, Error>
  readonly abort: () => Effect.Effect<void>
}

export interface Interface {
  readonly create: (input: ProcessorInput) => Effect.Effect<Handle, Error>
}

// ─── Implementation ──────────────────────────────────────────────────

export class Service extends Context.Service<Service, Interface>()("@agent-runtime/SessionProcessor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const create = Effect.fn("SessionProcessor.create")(function* (input: ProcessorInput) {
      let aborted = false
      let currentText = ""
      let lastFinishReason: string | undefined
      let eventCount = 0
      const toolCalls = new Map<string, { name: string; input: Record<string, unknown>; startTime: number }>()
      const assistantContent: ContentPart[] = []

      const emit = (data: ProcessorEventData) => {
        input.onEvent?.({
          type: data.type,
          sessionID: input.sessionID,
          messageID: input.messageID,
          data,
        })
      }

      // Track LLM-level errors that arrive as in-stream "error" events.
      // The Vercel AI SDK does NOT throw on transport-level failures
      // (e.g. 404 / 401 / network) — instead it surfaces them as
      // `{ type: "error", error: ... }` events inside the stream and
      // then closes the stream normally. If we don't handle these,
      // the UI never gets a finish/error signal and stays stuck on
      // the typing indicator.
      let llmStreamError: string | undefined

      const handleEvent = (event: LLMStreamEvent) =>
        Effect.gen(function* () {
          if (aborted) return

          eventCount++

          switch (event.type) {
            case "text-delta": {
              currentText += event.text
              emit({ type: "text-delta", text: event.text })
              return
            }

            case "tool-call": {
              toolCalls.set(event.id, {
                name: event.name,
                input: event.input,
                startTime: Date.now(),
              })
              assistantContent.push({
                type: "tool-call",
                id: event.id,
                name: event.name,
                input: event.input,
              })
              emit({ type: "tool-start", toolName: event.name, callID: event.id, input: event.input })
              return
            }

            case "tool-result": {
              const call = toolCalls.get(event.id)
              if (call) {
                assistantContent.push({
                  type: "tool-result",
                  id: event.id,
                  name: call.name,
                  result: event.result,
                  error: event.error,
                })
              }
              if (event.error) {
                emit({ type: "tool-error", callID: event.id, error: event.error })
              } else {
                emit({ type: "tool-complete", callID: event.id, result: event.result })
              }
              return
            }

            case "tool-error": {
              assistantContent.push({
                type: "tool-result",
                id: event.id,
                name: event.name,
                result: null,
                error: event.message,
              })
              emit({ type: "tool-error", callID: event.id, error: event.message })
              return
            }

            case "error": {
              // LLM-level error surfaced inside the stream (404, 401, network…).
              // Capture it so process() can emit error + finish, then keep
              // draining so the underlying AI SDK iterator can clean up.
              const message = extractErrorMessage(event.error)
              llmStreamError = message
              emit({ type: "error", error: message })
              return
            }

            case "finish": {
              // Track finish reason from the stream
              lastFinishReason = event.reason

              // Flush accumulated text
              if (currentText) {
                assistantContent.unshift({ type: "text", text: currentText })
                emit({ type: "text-complete", text: currentText })
                currentText = ""
              }
              emit({ type: "finish", reason: event.reason })
              return
            }
          }
        })

      const process = Effect.fn("SessionProcessor.process")(function* (
        stream: Stream.Stream<LLMStreamEvent, Error>,
      ) {
        let finishReason = "unknown"
        let error: string | undefined

        // Run the stream through handleEvent, but convert Effect failures
        // into a normal value so we can react to them. JS try/catch does NOT
        // catch Effect failures inside Effect.gen — we have to use catchAll.
        const drainResult = yield* stream.pipe(
          Stream.tap(handleEvent),
          Stream.runDrain,
          Effect.match({
            onFailure: (e: Error) => ({ ok: false as const, error: e }),
            onSuccess: () => ({ ok: true as const }),
          }),
        )

        if (drainResult.ok) {
          if (llmStreamError) {
            // The stream finished "successfully" but contained an in-band
            // error event (typical AI SDK behaviour for HTTP 4xx). Surface
            // it as the run's error and make sure the UI gets a finish so
            // the typing indicator stops.
            finishReason = "error"
            error = llmStreamError
            emit({ type: "finish", reason: "error" })
          } else if (lastFinishReason) {
            finishReason = lastFinishReason
          } else {
            finishReason = assistantContent.length > 0 ? "stop" : "empty"
            // Belt-and-braces: if the stream ended without a finish event
            // and without any text, still tell the UI we're done so the
            // typing indicator never gets stuck.
            if (assistantContent.length === 0 && !aborted) {
              emit({ type: "finish", reason: finishReason })
            }
          }
        } else {
          // Stream itself failed (e.g. fetch threw before any event).
          if (aborted) {
            finishReason = "aborted"
          } else {
            const message = drainResult.error instanceof Error
              ? drainResult.error.message
              : String(drainResult.error)
            finishReason = "error"
            error = message
            emit({ type: "error", error: message })
            emit({ type: "finish", reason: "error" })
          }
        }

        return {
          assistantContent,
          finishReason,
          error,
        } satisfies ProcessorResult
      })

      const abort = Effect.fn("SessionProcessor.abort")(function* () {
        aborted = true
      })

      return { process, abort } satisfies Handle
    })

    return Service.of({ create })
  }),
)

export const defaultLayer = layer

export const SessionProcessor = { Service, defaultLayer, layer }

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Best-effort conversion of an arbitrary "error" payload into a human
 * readable string. AI SDK surfaces backend HTTP errors as opaque values
 * (sometimes `Error`, sometimes objects with `name/message`, sometimes
 * stringified JSON), so we try a few shapes before falling back to
 * `String(err)`.
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Many AI SDK errors carry useful detail in `cause` (e.g. fetch Response).
    const cause = (err as Error & { cause?: unknown }).cause
    if (cause && typeof cause === "object" && "message" in cause && typeof (cause as { message: unknown }).message === "string") {
      return `${err.message}: ${(cause as { message: string }).message}`
    }
    return err.message || err.name || "LLM stream error"
  }
  if (err && typeof err === "object") {
    const anyErr = err as Record<string, unknown>
    const message = typeof anyErr.message === "string" ? anyErr.message : undefined
    const name = typeof anyErr.name === "string" ? anyErr.name : undefined
    const status = typeof anyErr.statusCode === "number"
      ? anyErr.statusCode
      : typeof anyErr.status === "number"
        ? anyErr.status
        : undefined
    const parts = [name, message, status ? `status=${status}` : undefined].filter(Boolean)
    if (parts.length > 0) return parts.join(" — ")
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}
