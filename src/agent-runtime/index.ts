/**
 * @agent-runtime — The Agent Runtime package for Seven: HROps
 *
 * This package provides a self-contained Agent engine that can:
 * - Run multi-step agent loops (tool call → result → continue)
 * - Connect to multiple AI providers (OpenAI, Anthropic, Ollama)
 * - Integrate with MCP servers for tool discovery and execution
 * - Manage sessions, permissions, skills, and agents
 *
 * ## Quick Start
 *
 * ```ts
 * import { AppRuntime, Session, Config } from "@agent-runtime"
 *
 * // 1. Create runtime with config
 * const runtime = AppRuntime.createRuntime({
 *   providers: {
 *     openai: { apiKey: process.env.OPENAI_API_KEY! },
 *     anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
 *   },
 *   defaultModel: { modelID: "gpt-4o", providerID: "openai" },
 *   mcpServers: {
 *     "seven-hrops": {
 *       type: "local",
 *       command: ["node", "./mcp-server/index.js"],
 *     },
 *   },
 * })
 *
 * // 2. Create a session
 * const session = await runtime.runPromise(Session.Service.create("assistant"))
 *
 * // 3. Run a conversation turn
 * const result = await runtime.runPromise(
 *   Session.Service.run(session.id, {
 *     message: "Screen all resumes for the Frontend Engineer position",
 *     onEvent: (event) => console.log(event),
 *   })
 * )
 *
 * // 4. Clean up
 * await runtime.dispose()
 * ```
 *
 * ## Architecture
 *
 * The runtime is built on the Effect framework for:
 * - Dependency injection via Layer/Context
 * - Composable error handling
 * - Resource lifecycle management (Scope)
 * - Streaming via Stream
 *
 * Core modules:
 * - **agent**: Agent definitions (assistant, screener, compliance)
 * - **tool-runtime**: The Agent tool call loop engine
 * - **session**: Session management + prompt execution
 * - **permission**: Tool access control
 * - **mcp**: MCP server integration
 * - **skill**: Skill management (screener, compliance)
 * - **plugin**: Hook-based plugin system (stub)
 * - **provider**: AI model provider adapters
 * - **config**: Runtime configuration
 * - **bus**: Event bus
 * - **core**: Effect runtime infrastructure
 */

// ─── Core Infrastructure ─────────────────────────────────────────────
export { AppRuntime, createAppLayer, createRuntime } from "./core/app-runtime"
export { makeRuntime } from "./core/runtime"
export { InstanceState } from "./core/instance-state"
export { EffectBridge } from "./core/bridge"
export { memoMap } from "./core/memo-map"

// ─── Configuration ───────────────────────────────────────────────────
export { Config, type AgentRuntimeConfig, type ModelConfig, type ProviderConfig } from "./config/index"

// ─── Agent System ────────────────────────────────────────────────────
export { Agent, type Info as AgentInfo } from "./agent/agent"
export {
  ToolRuntime,
  type ToolDefinition,
  type ToolCall,
  type ToolResult,
  type LLMStreamEvent,
  type ModelMessage,
  type ContentPart,
  type ModelAdapter,
  type StreamOptions,
  type StopCondition,
  stepCountIs,
} from "./agent/tool-runtime"

// ─── Session Management ──────────────────────────────────────────────
export {
  Session,
  type SessionInfo,
  type SessionMessage,
  type SessionRunOptions,
  type SessionRunResult,
} from "./session/session"
export { SessionPrompt, type PromptInput, type PromptResult } from "./session/prompt"
export {
  SessionProcessor,
  type ProcessorEvent,
  type ProcessorEventData,
  type ProcessorResult,
  type ProcessorEventHandler,
  type ProcessorInput,
  type Handle as ProcessorHandle,
} from "./session/processor"

// ─── Permission System ───────────────────────────────────────────────
export {
  Permission,
  type Action as PermissionAction,
  type Rule as PermissionRule,
  type Ruleset as PermissionRuleset,
  type AskInput as PermissionAskInput,
  type ReplyInput as PermissionReplyInput,
  evaluate as evaluatePermission,
  merge as mergePermissionRulesets,
} from "./permission/index"

// ─── MCP Integration ─────────────────────────────────────────────────
export { MCP, type MCPConfig, type MCPStatus } from "./mcp/index"

// ─── Skill System ────────────────────────────────────────────────────
export { Skill, type Info as SkillInfo, fmt as formatSkills } from "./skill/index"

// ─── Plugin System ───────────────────────────────────────────────────
export { Plugin, type Hooks as PluginHooks, type HookHandler } from "./plugin/index"

// ─── Provider System ─────────────────────────────────────────────────
export { Provider, type ProviderInfo } from "./provider/index"

// ─── Event Bus ───────────────────────────────────────────────────────
export { Bus } from "./bus/index"
