import { Effect, Stream, Schema, Context } from "effect"

/**
 * Tool Runtime — Agent tool orchestration engine.
 *
 * Adapted from OpenCode's tool-runtime.ts — this is the core loop that:
 * 1. Streams LLM responses
 * 2. Accumulates tool calls from the model
 * 3. Dispatches tool calls to their handlers
 * 4. Feeds tool results back to the model
 * 5. Repeats until the model stops or a stop condition is met
 *
 * Simplifications for HROps:
 * - Uses AI SDK types directly instead of OpenCode's custom LLM schema
 * - Removed providerExecuted tool result handling (not needed in HROps)
 * - Simplified streaming text accumulation
 *
 * ─── INVARIANT (arch-runtime-single-loop) ────────────────────────────
 *
 * This module owns the **ONLY** agentic loop in the system. Provider /
 * ModelAdapter implementations MUST emit raw `tool-call` events without
 * executing tools — tool execution belongs solely to `dispatch` below.
 *
 * Violating this invariant produces one of two failure modes:
 *
 *   - **Deadlock**: SDK keeps the call open waiting for `tool-result`
 *     while ToolRuntime executes the tool externally; SDK never receives
 *     the follow-up and the stream never finishes (UI stuck spinning).
 *   - **Double-dispatch**: Both layers run the tool, conversation history
 *     explodes, `maxSteps` accounting drifts.
 *
 * The Provider layer enforces this by passing only `description` +
 * `inputSchema` to AI SDK `streamText`, plus `stopWhen: stepCountIs(1)`.
 * See `src/agent-runtime/provider/index.ts` and the change proposal at
 * `openspec/changes/arch-runtime-single-loop/`.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown> // JSON Schema
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>
}

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

export interface ToolResult {
  readonly id: string
  readonly name: string
  readonly result: unknown
  readonly error?: string
}

export type LLMStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool-result"; id: string; name: string; result: unknown; error?: string }
  | { type: "tool-error"; id: string; name: string; message: string }
  | { type: "error"; error: unknown }
  | { type: "finish"; reason: string }

export interface RuntimeState {
  readonly step: number
  readonly maxSteps: number
}

export type StopCondition = (state: RuntimeState) => boolean

export const stepCountIs =
  (count: number): StopCondition =>
  (state) =>
    state.step + 1 >= count

export interface StreamOptions {
  readonly messages: ReadonlyArray<ModelMessage>
  readonly tools: ReadonlyArray<ToolDefinition>
  readonly model: ModelAdapter
  readonly maxSteps?: number
  readonly stopWhen?: StopCondition
  readonly systemPrompt?: string
  readonly temperature?: number
  /** Runtime-level guard for external tool IO. Defaults to 30s. */
  readonly toolTimeoutMs?: number
}

export interface ModelMessage {
  readonly role: "system" | "user" | "assistant" | "tool"
  readonly content: string | ReadonlyArray<ContentPart>
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool-result"; id: string; name: string; result: unknown; error?: string }

export interface ModelAdapter {
  readonly stream: (options: {
    messages: ReadonlyArray<ModelMessage>
    tools: ReadonlyArray<ToolDefinition>
    systemPrompt?: string
    temperature?: number
  }) => Stream.Stream<LLMStreamEvent, Error>
}

// ─── State ───────────────────────────────────────────────────────────

interface StepState {
  assistantContent: ContentPart[]
  toolCalls: ToolCall[]
  finishReason: string | undefined
}

// ─── Core Loop ───────────────────────────────────────────────────────

/**
 * Run the agent tool loop. This is the heart of the Agent Runtime.
 *
 * The loop:
 * 1. Send messages + tool definitions to the model
 * 2. Stream back the model's response (text + tool calls)
 * 3. If tool calls were made, execute them concurrently
 * 4. Feed results back to the model
 * 5. Repeat until the model finishes (no more tool calls) or stop condition is met
 */
const DEFAULT_TOOL_TIMEOUT_MS = 30_000

export const stream = (options: StreamOptions): Stream.Stream<LLMStreamEvent, Error> => {
  const maxSteps = options.maxSteps ?? 50
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const toolsByName = new Map(options.tools.map((t) => [t.name, t]))

  const loop = (
    messages: ReadonlyArray<ModelMessage>,
    step: number,
  ): Stream.Stream<LLMStreamEvent, Error> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const state: StepState = {
          assistantContent: [],
          toolCalls: [],
          finishReason: undefined,
        }

        // Defensive guard (arch-runtime-single-loop):
        //   `seenIds` is per-step. If the same `tool-call.id` shows up twice
        //   inside one step, the Provider layer most likely reverted to
        //   executing tools internally (e.g. by passing `execute` to AI SDK).
        //   We warn loudly so the regression is caught in dev/CI logs.
        const seenIds = new Set<string>()

        // Stream the model's response
        const modelStream = options.model
          .stream({
            messages,
            tools: options.tools,
            systemPrompt: options.systemPrompt,
            temperature: options.temperature,
          })
          .pipe(
            Stream.tap((event) =>
              Effect.sync(() => {
                if (event.type === "tool-call") {
                  if (seenIds.has(event.id)) {
                    // eslint-disable-next-line no-console
                    console.warn(
                      `[ToolRuntime] duplicate tool-call.id detected: ${event.id} ` +
                        `(name=${event.name}). This usually means the provider layer ` +
                        `is also executing tools — see arch-runtime-single-loop.`,
                    )
                  }
                  seenIds.add(event.id)
                }
                accumulate(state, event)
              }),
            ),
          )

        // After model finishes, decide what to do
        const continuation = Stream.unwrap(
          Effect.gen(function* () {
            if (state.toolCalls.length === 0) {
              return Stream.empty
            }

            // If the provider already emitted tool-call events, the runtime must dispatch them
            // regardless of the provider-specific finish reason spelling. Some prompt-style /
            // OpenAI-compatible providers end the step with "stop" or an undefined reason after
            // textual tool-call tokens, and gating dispatch only on "tool-calls" leaves the UI
            // tool bubble pending forever.
            // eslint-disable-next-line no-console
            if (state.finishReason !== "tool-calls") {
              console.warn(
                `[ToolRuntime] dispatching ${state.toolCalls.length} collected tool-call(s) despite finishReason=${state.finishReason ?? "<missing>"}`,
              )
            }

            // Execute all tool calls concurrently
            const dispatched = yield* Effect.forEach(
              state.toolCalls,
              (call) =>
                dispatch(toolsByName, call, toolTimeoutMs).pipe(
                  Effect.map((result) => [call, result] as const),
                ),
              { concurrency: 10 },
            )

            // Emit tool result events
            const resultEvents: LLMStreamEvent[] = []
            for (const [call, result] of dispatched) {
              if (result.error) {
                resultEvents.push(
                  { type: "tool-error", id: call.id, name: call.name, message: result.error },
                  { type: "tool-result", id: call.id, name: call.name, result: result.result, error: result.error },
                )
              } else {
                resultEvents.push(
                  { type: "tool-result", id: call.id, name: call.name, result: result.result },
                )
              }
            }

            const resultStream = Stream.fromIterable(resultEvents)

            // Check stop conditions
            const runtimeState: RuntimeState = { step, maxSteps }
            if (options.stopWhen?.(runtimeState)) return resultStream
            if (step + 1 >= maxSteps) return resultStream

            // Build follow-up messages and continue the loop
            const followUpMessages: ModelMessage[] = [
              ...messages,
              { role: "assistant", content: state.assistantContent },
              ...dispatched.map(
                ([call, result]): ModelMessage => ({
                  role: "tool",
                  content: [{ type: "tool-result", id: call.id, name: call.name, result: result.result, error: result.error }],
                }),
              ),
            ]

            return resultStream.pipe(
              Stream.concat(loop(followUpMessages, step + 1)),
            )
          }),
        )

        return modelStream.pipe(Stream.concat(continuation))
      }),
    )

  return loop(options.messages, 0)
}

// ─── Helpers ─────────────────────────────────────────────────────────

const accumulate = (state: StepState, event: LLMStreamEvent) => {
  if (event.type === "text-delta") {
    const last = state.assistantContent.at(-1)
    if (last?.type === "text") {
      state.assistantContent[state.assistantContent.length - 1] = {
        ...last,
        text: `${last.text}${event.text}`,
      }
    } else {
      state.assistantContent.push({ type: "text", text: event.text })
    }
    return
  }
  if (event.type === "reasoning-delta") {
    // Reasoning is not accumulated into content for now
    return
  }
  if (event.type === "tool-call") {
    const part: ContentPart = {
      type: "tool-call",
      id: event.id,
      name: event.name,
      input: event.input,
    }
    state.assistantContent.push(part)
    state.toolCalls.push({ id: event.id, name: event.name, input: event.input })
    return
  }
  if (event.type === "finish") {
    state.finishReason = event.reason
  }
}

const dispatch = (
  toolsByName: Map<string, ToolDefinition>,
  call: ToolCall,
  timeoutMs: number,
): Effect.Effect<ToolResult, never> =>
  Effect.gen(function* () {
    const tool = toolsByName.get(call.name)
    if (!tool) {
      return { id: call.id, name: call.name, result: null, error: `Unknown tool: ${call.name}` }
    }
    if (!tool.execute) {
      return { id: call.id, name: call.name, result: null, error: `Tool has no execute handler: ${call.name}` }
    }

    const result = yield* Effect.tryPromise({
      try: () => withTimeout(tool.execute(call.input), timeoutMs, call.name),
      catch: (err) => (err instanceof Error ? err : new Error(String(err))),
    }).pipe(
      Effect.mapError((err) => err.message),
      Effect.match({
        onFailure: (error) => ({ id: call.id, name: call.name, result: null, error }),
        onSuccess: (result) => ({ id: call.id, name: call.name, result }),
      }),
    )
    return result
  })

function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    const label = ms < 1_000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`
    timer = setTimeout(
      () => reject(new Error(`Tool "${toolName}" timed out after ${label}`)),
      ms,
    )
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export const ToolRuntime = { stream, stepCountIs } as const
