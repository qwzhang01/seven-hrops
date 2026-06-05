/**
 * TOOL_REGISTRY — single-source-of-truth for every tool's metadata.
 *
 * Phase B contract:
 *   - Toolpack files (fs / parse / webserver / export / system / builder) MUST
 *     read meta from this file; they MUST NOT redeclare `category`, `riskLevel`,
 *     `defaultAllowedSources`, `requireApproval` inline.
 *   - Adding a new tool: append a record here, then add an invoker in the
 *     matching toolpack file. Manifest validation rejects unknown names.
 *
 * Spec ref: openspec/changes/phase-b-platform-foundation/specs/tool-registry/spec.md
 */

import type { ToolMeta, ToolSource } from "@/platform/registry/toolRegistry"

// ── ToolMeta extensions ──────────────────────────────────────────────────────
// ToolMeta is defined in toolRegistry.ts; we augment it here with optional
// fields used by higher layers.
declare module "@/platform/registry/toolRegistry" {
  interface ToolMeta {
    /**
     * JSON Schema for the tool's input parameters.
     *
     * This is the **single source of truth** for the tool's parameter schema.
     * `toolRegistry.toToolDefinitions()` reads this field to build `ToolDefinition`
     * objects for `ToolRuntime`. Toolpack files MUST NOT redeclare parameter
     * schemas elsewhere — they must be defined here.
     *
     * Tools that are only invoked internally (e.g. `sandbox_create`) and never
     * exposed to LLMs may omit this field.
     */
    parameters?: {
      type: "object"
      properties: Record<string, unknown>
      required?: string[]
    }
    /** Optional UI label shown in ToolCallBubble during execution. */
    progressLabel?: string
    /**
     * Phase G Task 4.1: The agent that exclusively owns this tool.
     * When set, only the named agent may invoke this tool — calls from any
     * other agent are rejected by `toolWhitelistGuard` (Task 4.5).
     * Omit for tools that are available to all agents within their source scope.
     */
    ownerAgent?: string
  }
}

const ALL_SOURCES: ReadonlyArray<ToolSource> = ["builtin", "user", "marketplace"]
const BUILTIN_USER: ReadonlyArray<ToolSource> = ["builtin", "user"]
const BUILTIN_ONLY: ReadonlyArray<ToolSource> = ["builtin"]

/**
 * Authoritative tool catalogue for Phase B platform foundation.
 *
 * Indexed by tool name to support O(1) `_registry.ts` lookups from toolpack
 * `register()` functions.
 */
export const TOOL_REGISTRY: Readonly<Record<string, ToolMeta>> = Object.freeze({
  // ── fs-toolpack (6 tools) ────────────────────────────────────────────────
  read_file: {
    name: "read_file",
    category: "safe",
    riskLevel: "low",
    description:
      "Read a UTF-8 text file. Sandbox-gated by session_id; path must be in read whitelist.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read (relative to workspace root or absolute within sandbox)" },
      },
      required: ["path"],
    },
  },
  write_file: {
    name: "write_file",
    category: "write",
    riskLevel: "medium",
    description:
      "Write UTF-8 text to a file. Sandbox-gated; path must be in write whitelist.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to write" },
        content: { type: "string", description: "UTF-8 text content to write" },
      },
      required: ["path", "content"],
    },
  },
  copy_file: {
    name: "copy_file",
    category: "write",
    riskLevel: "medium",
    description:
      "Copy a file byte-for-byte. Sandbox-gated; source must be in read whitelist and destination in write whitelist.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    parameters: {
      type: "object",
      properties: {
        fromPath: { type: "string", description: "Source file path" },
        toPath: { type: "string", description: "Destination file path" },
      },
      required: ["fromPath", "toPath"],
    },
  },
  list_dir: {
    name: "list_dir",
    category: "safe",
    riskLevel: "low",
    description: "List entries of a directory. Sandbox-gated by read whitelist.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute directory path to list (MUST be absolute, e.g. /Users/xxx/workspaces/my-ws/01_inputs). Relative paths like '01_inputs/' will fail with NATIVE_IO_FAILED." },
        // dir_path is accepted as an alias for compatibility with LLM providers
        // that use non-standard field names (e.g. 豆包/Volcengine true-machine payload).
        // toolRegistry.toToolDefinitions() normalises dir_path → path before invoking.
        dir_path: { type: "string", description: "Alias for path — accepted for compatibility with some LLM providers" },
      },
    },
  },
  stat_file: {
    name: "stat_file",
    category: "safe",
    riskLevel: "low",
    description: "Return file metadata (size, modified time, type).",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to stat" },
      },
      required: ["path"],
    },
  },
  canonicalize_path: {
    name: "canonicalize_path",
    category: "safe",
    riskLevel: "low",
    description:
      "Resolve a path to its canonical absolute form (symlink/`..` resolved). Used for sandbox boundary checks.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to canonicalize" },
      },
      required: ["path"],
    },
  },

  // ── parse-toolpack (3 tools) ─────────────────────────────────────────────
  parse_pdf: {
    name: "parse_pdf",
    category: "safe",
    riskLevel: "low",
    description: "Extract text and page count from a PDF file via pdfium FFI.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    progressLabel: "正在解析 PDF...",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the PDF file" },
      },
      required: ["path"],
    },
  },
  parse_docx: {
    name: "parse_docx",
    category: "safe",
    riskLevel: "low",
    description: "Extract text from a DOCX file.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    progressLabel: "正在解析 Word 文档...",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the DOCX file" },
      },
      required: ["path"],
    },
  },
  parse_excel: {
    name: "parse_excel",
    category: "safe",
    riskLevel: "low",
    description: "Extract sheet names, row counts and cell matrix from XLSX.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the XLSX file" },
      },
      required: ["path"],
    },
  },

  // ── webserver-toolpack (7 tools — Phase B: 2, Phase F: +5) ────────────────
  webserver_start: {
    name: "webserver_start",
    category: "system",
    riskLevel: "medium",
    description:
      "Ensure the embedded web server is started and return connection info (host, port, baseUrl).",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
  },
  webserver_publish: {
    name: "webserver_publish",
    category: "write",
    riskLevel: "medium",
    description:
      "Publish content to the embedded web server; returns handle/url/qr. TTL bounded.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
  },
  webserver_drop: {
    name: "webserver_drop",
    category: "safe",
    riskLevel: "low",
    description: "Release a previously published webserver handle.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
  },
  webserver_create_form: {
    name: "webserver_create_form",
    category: "system",
    riskLevel: "medium",
    description:
      "Publish an HTML form page with submission interception. Returns access URL + QR for candidates.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
    progressLabel: "正在发布表单页面...",
  },
  webserver_collect_submission: {
    name: "webserver_collect_submission",
    category: "system",
    riskLevel: "medium",
    description:
      "Collect form submissions for a published form page. Writes results to workspace.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
  },
  webserver_qrcode: {
    name: "webserver_qrcode",
    category: "safe",
    riskLevel: "low",
    description:
      "Generate a QR code PNG for a given URL. Optionally saves to workspace.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
  },

  // ── (model + transcribe — exposed via system-toolpack) ───────────────────
  models_ensure: {
    name: "models_ensure",
    category: "system",
    riskLevel: "medium",
    description:
      "Ensure a registered model is downloaded and sha256-verified locally. Returns status + path.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
  },
  transcribe_audio: {
    name: "transcribe_audio",
    category: "parse",
    riskLevel: "medium",
    description:
      "Transcribe an audio file via whisper-rs FFI. Auto-ensures the whisper-base-zh model. Sandbox-gated by session_id.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
    progressLabel: "正在转写音频...",
  },

  // ── export-toolpack (2 tools) ─────────────────────────────────────────────
  export_to_html: {
    name: "export_to_html",
    category: "write",
    riskLevel: "medium",
    description: "Write a string of HTML to a file under the write whitelist.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    progressLabel: "正在生成 HTML 报告...",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Output file path" },
        content: { type: "string", description: "HTML content to write" },
      },
      required: ["path", "content"],
    },
  },
  export_to_word: {
    name: "export_to_word",
    category: "write",
    riskLevel: "medium",
    description: "Generate a .docx Word document from plain text content via docx-rs.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    progressLabel: "正在生成 Word 文档...",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Output file path (.docx)" },
        content: { type: "string", description: "Plain text content to convert to Word document" },
      },
      required: ["path", "content"],
    },
  },
  export_to_pptx: {
    name: "export_to_pptx",
    category: "write",
    riskLevel: "medium",
    description: "Generate a .pptx PowerPoint presentation from structured slide data via pptxgenjs.",
    defaultAllowedSources: ALL_SOURCES,
    requireApproval: false,
    progressLabel: "正在生成 PPTX...",
  },

  // ── network-toolpack (Phase F Task 4.1) ────────────────────────────────
  get_weather: {
    name: "get_weather",
    category: "network",
    riskLevel: "medium",
    description:
      "Get current weather for a city via OpenWeatherMap API. Falls back to mock data on failure.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
    progressLabel: "正在获取天气...",
  },

  // ── music-toolpack (Phase F Task 4.2) ─────────────────────────────────
  get_user_playlist: {
    name: "get_user_playlist",
    category: "safe",
    riskLevel: "low",
    description: "Get the user's mock music playlist (local catalogue, no network).",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
  },
  recommend_tracks: {
    name: "recommend_tracks",
    category: "network",
    riskLevel: "medium",
    description:
      "Recommend tracks based on mood and weather. Uses local mock catalogue (no third-party API).",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
    progressLabel: "正在推荐曲目...",
  },

  // ── sandbox-toolpack (2 tools — lifecycle management) ────────────────────
  sandbox_create: {
    name: "sandbox_create",
    category: "system",
    riskLevel: "low",
    description:
      "Register a sandbox session in the Rust registry. Must be called before any fs/native tool invocation. source='builtin' fast-paths all path checks.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
  },
  sandbox_drop: {
    name: "sandbox_drop",
    category: "system",
    riskLevel: "low",
    description:
      "Remove a sandbox session from the Rust registry. Returns true if the session existed.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
  },

  // ── system-toolpack (2 tools — Phase G: real implementation) ──────────────────
  activate_capability: {
    name: "activate_capability",
    category: "control",
    riskLevel: "high",
    description:
      "Switch the runtime active Capability (declarative agent + skills bundle). Routes the user to the appropriate capability based on their intent.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
    ownerAgent: "assistant",
    parameters: {
      type: "object",
      properties: {
        capabilityId: { type: "string", description: "The ID of the capability to activate" },
      },
      required: ["capabilityId"],
    },
  },
  delegate_to_subagent: {
    name: "delegate_to_subagent",
    category: "control",
    riskLevel: "high",
    description:
      "Delegate a sub-task to a registered Agent and stream results back. The parent session stays active while the child agent handles the delegated work.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
    ownerAgent: "assistant",
    parameters: {
      type: "object",
      properties: {
        agentName: { type: "string", description: "Name of the agent to delegate to" },
        prompt: { type: "string", description: "The task/prompt to pass to the sub-agent" },
      },
      required: ["agentName", "prompt"],
    },
  },

  // ── assistant-toolpack (2 tools — Phase 5) ──────────────────────────────
  identify_intent: {
    name: "identify_intent",
    category: "safe",
    riskLevel: "low",
    description:
      "分析用户消息，识别意图类型（闲聊/使用能力/任务管理），返回意图和置信度。",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
    ownerAgent: "assistant",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "用户输入的消息内容" },
      },
      required: ["message"],
    },
  },
  log_session_event: {
    name: "log_session_event",
    category: "system",
    riskLevel: "low",
    description:
      "记录会话事件（会话开始/能力激活/消息发送/错误发生等），为企微集成预留接口。",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
    ownerAgent: "assistant",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "会话 ID" },
        eventType: {
          type: "string",
          description: "事件类型: session_started | capability_activated | message_sent | error_occurred | session_completed",
        },
        payload: { type: "object", description: "可选的事件负载数据" },
      },
      required: ["sessionId", "eventType"],
    },
  },

  // ── orchestrator-toolpack (3 tools — Phase G) ────────────────────────────────
  get_all_tasks: {
    name: "get_all_tasks",
    category: "safe",
    riskLevel: "low",
    description:
      "Query all tasks with optional filter (status, assignee). Returns task list for orchestrator.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
    ownerAgent: "orchestrator",
    parameters: {
      type: "object",
      properties: {
        filter: {
          type: "object",
          description: "Optional filter criteria",
          properties: {
            status: { type: "string", description: "Filter by status" },
            assignee: { type: "string", description: "Filter by assignee" },
          },
        },
      },
    },
  },
  update_task_status: {
    name: "update_task_status",
    category: "messaging",
    riskLevel: "medium",
    description:
      "Update a task's status. Emits task-changed event for UI reactivity.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
    ownerAgent: "orchestrator",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "ID of the task to update" },
        status: { type: "string", description: "New status: pending | in-progress | done | cancelled" },
      },
      required: ["taskId", "status"],
    },
  },
  send_wecom_message: {
    name: "send_wecom_message",
    category: "messaging",
    riskLevel: "high",
    description:
      "Send a message via enterprise WeChat bot webhook. Requires bot to be in allowedBots whitelist.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: true,
    ownerAgent: "orchestrator",
    parameters: {
      type: "object",
      properties: {
        botId: { type: "string", description: "WeChat bot webhook key" },
        content: { type: "string", description: "Message content to send" },
        toUser: { type: "string", description: "Optional: specific user to mention" },
      },
      required: ["botId", "content"],
    },
  },

  // ── builder-toolpack (4 tools — all stub, deferred to Phase H) ───────────
  create_agent_manifest: {
    name: "create_agent_manifest",
    category: "builder",
    riskLevel: "high",
    description:
      "Generate an Agent manifest YAML from natural-language intent. Deferred to Phase H.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: true,
  },
  create_skill_manifest: {
    name: "create_skill_manifest",
    category: "builder",
    riskLevel: "high",
    description:
      "Generate a Skill manifest YAML + body. Deferred to Phase H.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: true,
  },
  create_capability_manifest: {
    name: "create_capability_manifest",
    category: "builder",
    riskLevel: "high",
    description:
      "Generate a Capability manifest YAML. Deferred to Phase H.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: true,
  },
  list_available_tools: {
    name: "list_available_tools",
    category: "builder",
    riskLevel: "low",
    description:
      "List tool metadata available to the current source for builder UX. Deferred to Phase H.",
    defaultAllowedSources: BUILTIN_ONLY,
    requireApproval: false,
  },
} as const)

/** Helper for toolpacks: assert meta exists then return it. */
export function metaOf(name: string): ToolMeta {
  const m = TOOL_REGISTRY[name]
  if (!m) {
    throw new Error(
      `TOOL_META_NOT_FOUND: "${name}" missing from _registry.ts; add it before registering an invoker.`,
    )
  }
  return m
}
