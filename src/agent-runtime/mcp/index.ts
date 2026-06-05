import { Effect, Layer, Context, Schema, Stream } from "effect"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
// StdioClientTransport is Node.js-only (uses cross-spawn / process.env).
// It must NOT be statically imported — doing so pulls `cross-spawn` into the
// browser bundle and crashes with "Can't find variable: process".
// Dynamic import is used in connectLocal() so Vite/esbuild never bundles it.
type StdioClientTransport = import("@modelcontextprotocol/sdk/client/stdio.js").StdioClientTransport
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  CallToolResultSchema,
  ToolSchema,
  type Tool as MCPToolDef,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type { ToolDefinition } from "../agent/tool-runtime"

/**
 * MCP Integration — Connect to MCP servers and expose their tools to Agents.
 *
 * Adapted from OpenCode's mcp/index.ts (970 lines) — simplified for HROps:
 * - Removed: OAuth authentication flow, Browser open, Toast notifications,
 *   Auth token management, Config integration, Prompt/Resource APIs
 * - Kept: MCP client creation, Local/Remote transport, Tool discovery,
 *   Tool execution, Connection lifecycle
 * - Simplified: Direct config instead of Config.Service dependency
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface MCPConfig {
  /** "local" for stdio, "remote" for HTTP/SSE */
  type: "local" | "remote"
  /** For local: command + args to spawn */
  command?: string[]
  /** For remote: URL to connect to */
  url?: string
  /** Environment variables for local servers */
  environment?: Record<string, string>
  /** HTTP headers for remote servers */
  headers?: Record<string, string>
  /** Connection timeout in ms */
  timeout?: number
  /** Whether this server is enabled */
  enabled?: boolean
}

export type MCPStatus =
  | { status: "connected" }
  | { status: "disconnected" }
  | { status: "failed"; error: string }
  | { status: "disabled" }

// ─── Service ─────────────────────────────────────────────────────────

export interface Interface {
  readonly connect: (name: string, config: MCPConfig) => Effect.Effect<void>
  readonly disconnect: (name: string) => Effect.Effect<void>
  readonly status: () => Effect.Effect<Record<string, MCPStatus>>
  readonly tools: () => Effect.Effect<ReadonlyArray<ToolDefinition>>
  readonly callTool: (name: string, args: Record<string, unknown>) => Effect.Effect<unknown, Error>
  readonly listServers: () => Effect.Effect<ReadonlyArray<{ name: string; status: MCPStatus }>>
}

export class Service extends Context.Service<Service, Interface>()("@agent-runtime/MCP") {}

const DEFAULT_TIMEOUT = 30_000
const CLIENT_NAME = "seven-hrops"
const CLIENT_VERSION = "1.0.0"

// ─── Implementation ──────────────────────────────────────────────────

interface ServerEntry {
  name: string
  config: MCPConfig
  client?: Client
  status: MCPStatus
  toolDefs: MCPToolDef[]
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const servers = new Map<string, ServerEntry>()

    const connect = Effect.fn("MCP.connect")(function* (name: string, config: MCPConfig) {
      if (config.enabled === false) {
        servers.set(name, { name, config, status: { status: "disabled" }, toolDefs: [] })
        return
      }

      const timeout = config.timeout ?? DEFAULT_TIMEOUT

      let client: Client | undefined
      let status: MCPStatus = { status: "failed", error: "Unknown error" }

      try {
        if (config.type === "local") {
          const result = yield* connectLocal(name, config, timeout)
          client = result.client
          status = result.status
        } else if (config.type === "remote") {
          const result = yield* connectRemote(name, config, timeout)
          client = result.client
          status = result.status
        }

        if (!client) {
          servers.set(name, { name, config, status, toolDefs: [] })
          return
        }

        // Discover tools
        const toolDefs = yield* listTools(name, client, timeout)

        // Watch for tool list changes
        watchToolChanges(name, client, servers, timeout)

        servers.set(name, { name, config, client, status, toolDefs })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        servers.set(name, { name, config, status: { status: "failed", error: message }, toolDefs: [] })
      }
    })

    const disconnect = Effect.fn("MCP.disconnect")(function* (name: string) {
      const entry = servers.get(name)
      if (!entry) return

      if (entry.client) {
        yield* Effect.tryPromise(() => entry.client!.close()).pipe(Effect.ignore)
      }
      entry.client = undefined
      entry.status = { status: "disconnected" }
      entry.toolDefs = []
    })

    const status = Effect.fn("MCP.status")(function* () {
      const result: Record<string, MCPStatus> = {}
      for (const [name, entry] of servers) {
        result[name] = entry.status
      }
      return result
    })

    const tools = Effect.fn("MCP.tools")(function* () {
      const result: ToolDefinition[] = []
      for (const [serverName, entry] of servers) {
        if (entry.status.status !== "connected" || !entry.client) continue

        const timeout = entry.config.timeout ?? DEFAULT_TIMEOUT
        for (const mcpTool of entry.toolDefs) {
          result.push(
            convertMcpToolToDefinition(serverName, mcpTool, entry.client, timeout),
          )
        }
      }

      // Also include tools from internal (embedded) MCP servers
      for (const [name, internalServer] of internalServers) {
        for (const toolDef of internalServer.toolDefs) {
          result.push(toolDef)
        }
      }

      return result
    })

    const callTool = Effect.fn("MCP.callTool")(function* (toolName: string, args: Record<string, unknown>) {
      // Find which server owns this tool
      for (const [, entry] of servers) {
        if (entry.status.status !== "connected" || !entry.client) continue

        const toolDef = entry.toolDefs.find((t) => t.name === toolName)
        if (!toolDef) continue

        const result = yield* Effect.tryPromise({
          try: () =>
            entry.client!.callTool(
              { name: toolName, arguments: args },
              CallToolResultSchema,
              { timeout: entry.config.timeout ?? DEFAULT_TIMEOUT },
            ),
          catch: (err) => (err instanceof Error ? err : new Error(String(err))),
        })

        return result
      }

      // Check internal (embedded) MCP servers
      for (const [, internalServer] of internalServers) {
        const toolDef = internalServer.toolDefs.find((t) => t.name === toolName)
        if (!toolDef) continue

        const result = yield* Effect.tryPromise({
          try: () => toolDef.execute(args),
          catch: (err) => (err instanceof Error ? err : new Error(String(err))),
        })

        return result
      }

      throw new Error(`Tool "${toolName}" not found in any connected MCP server`)
    })

    const listServers = Effect.fn("MCP.listServers")(function* () {
      return Array.from(servers.values()).map((entry) => ({
        name: entry.name,
        status: entry.status,
      }))
    })

    return Service.of({ connect, disconnect, status, tools, callTool, listServers })
  }),
)

// ─── Helpers ─────────────────────────────────────────────────────────

function connectLocal(
  name: string,
  config: MCPConfig,
  timeout: number,
): Effect.Effect<{ client?: Client; status: MCPStatus }> {
  return Effect.gen(function* () {
    if (!config.command || config.command.length === 0) {
      return { status: { status: "failed", error: "No command specified for local MCP server" } }
    }

    const [cmd, ...args] = config.command
    // Dynamic import keeps StdioClientTransport out of the browser bundle.
    // In Tauri, this code path only runs in the Rust-managed Node context;
    // the browser WebView never reaches here.
    // Use Effect.promise (not await) because we're inside Effect.gen, not an async function.
    const { StdioClientTransport } = yield* Effect.promise(() =>
      import("@modelcontextprotocol/sdk/client/stdio.js"),
    )
    const transport = new StdioClientTransport({
      stderr: "pipe",
      command: cmd,
      args,
      env: {
        // process.env is available in Node/Tauri sidecar context, not in browser.
        // Use empty object as fallback so TypeScript is happy.
        ...(typeof process !== "undefined" && process.env
          ? Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined))
          : {}),
        ...config.environment,
      } as Record<string, string>,
    })

    return yield* connectTransport(transport, timeout).pipe(
      Effect.map((client) => ({ client, status: { status: "connected" } as MCPStatus })),
      Effect.catch((error) => {
        const msg = error instanceof Error ? error.message : String(error)
        return Effect.succeed({ status: { status: "failed", error: msg } as MCPStatus })
      }),
    )
  })
}

function connectRemote(
  name: string,
  config: MCPConfig,
  timeout: number,
): Effect.Effect<{ client?: Client; status: MCPStatus }> {
  return Effect.gen(function* () {
    if (!config.url) {
      return { status: { status: "failed", error: "No URL specified for remote MCP server" } }
    }

    const url = new URL(config.url)

    // Try StreamableHTTP first, then SSE
    const transports = [
      new StreamableHTTPClientTransport(url, {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      }),
      new SSEClientTransport(url, {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      }),
    ]

    for (const transport of transports) {
      const result = yield* connectTransport(transport, timeout).pipe(
        Effect.map((client) => ({ client, status: { status: "connected" } as MCPStatus })),
        Effect.catch(() =>
          Effect.succeed(undefined as { client?: Client; status: MCPStatus } | undefined),
        ),
      )

      if (result?.client) return result
    }

    return { status: { status: "failed", error: `Failed to connect to ${config.url}` } }
  })
}

function connectTransport(transport: StreamableHTTPClientTransport | SSEClientTransport | InstanceType<typeof import("@modelcontextprotocol/sdk/client/stdio.js")["StdioClientTransport"]>, timeout: number) {
  return Effect.acquireUseRelease(
    Effect.succeed(transport),
    (t) =>
      Effect.tryPromise({
        try: () => {
          const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION })
          const connectPromise = client.connect(t)
          return withTimeout(connectPromise, timeout).then(() => client)
        },
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    (t, exit) =>
      exit._tag === "Failure" ? Effect.tryPromise(() => t.close()).pipe(Effect.ignore) : Effect.void,
  )
}

function listTools(name: string, client: Client, timeout: number) {
  return Effect.tryPromise({
    try: () => client.listTools(undefined, { timeout }),
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  }).pipe(
    Effect.map((result) => result.tools),
    Effect.catch(() => Effect.succeed([] as MCPToolDef[])),
  )
}

function watchToolChanges(
  serverName: string,
  client: Client,
  servers: Map<string, ServerEntry>,
  timeout: number,
) {
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    const entry = servers.get(serverName)
    if (!entry || entry.client !== client) return

    try {
      const result = await client.listTools(undefined, { timeout })
      entry.toolDefs = result.tools
    } catch {
      // Ignore errors on tool list refresh
    }
  })
}

function convertMcpToolToDefinition(
  serverName: string,
  mcpTool: MCPToolDef,
  client: Client,
  timeout?: number,
): ToolDefinition {
  const sanitizedServer = serverName.replace(/[^a-zA-Z0-9_-]/g, "_")
  const sanitizedTool = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, "_")
  const fullName = `${sanitizedServer}_${sanitizedTool}`

  return {
    name: fullName,
    description: mcpTool.description ?? "",
    parameters: (mcpTool.inputSchema as Record<string, unknown>) ?? {},
    execute: async (args) => {
      const result = await client.callTool(
        { name: mcpTool.name, arguments: args },
        CallToolResultSchema,
        { timeout, resetTimeoutOnProgress: true },
      )
      return result
    },
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Connection timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

export const defaultLayer = layer

export const MCP = { Service, defaultLayer, layer }

// ─── Internal MCP Server Registration ──────────────────────────────────────

/**
 * Register an internal MCP server (running in the same process).
 * Unlike external MCP servers (spawned via stdio/HTTP), internal servers
 * are created in-process and share the same Effect runtime.
 *
 * The internal server's tools are provided as an array of InternalToolDefinition
 * alongside the McpServer instance, so we don't need to introspect the server.
 */
export interface InternalToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

export interface InternalMcpServer {
  server: McpServer
  tools: InternalToolDefinition[]
}

export function registerInternalServer(
  name: string,
  internalServer: InternalMcpServer,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const toolDefs: ToolDefinition[] = []
    for (const tool of internalServer.tools) {
      const fullName = `internal_${name}_${tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`
      toolDefs.push({
        name: fullName,
        description: tool.description ?? "",
        parameters: tool.parameters ?? {},
        execute: tool.execute,
      })
    }

    // Store the internal server for later access by tools() and callTool()
    internalServers.set(name, { server: internalServer.server, toolDefs })
  })
}

// ─── Internal Server Store ──────────────────────────────────────────────────

/** Map of internal MCP servers keyed by name */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internalServers = new Map<string, { server: McpServer; toolDefs: ToolDefinition[] }>()

/**
 * Get an internal MCP server by name.
 * Used by the MCP Service implementation to discover internal server tools.
 */
export function getInternalServer(name: string) {
  return internalServers.get(name)
}
