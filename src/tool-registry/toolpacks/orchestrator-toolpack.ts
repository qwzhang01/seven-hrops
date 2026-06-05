/**
 * orchestrator-toolpack — Phase G: tools exclusive to the orchestrator Agent.
 *
 * Tools:
 *   - get_all_tasks: query task store with optional filter
 *   - update_task_status: update a task's status
 *   - send_wecom_message: send a message via enterprise WeChat bot
 *
 * Spec: openspec/changes/assistant-silent-switch/specs/orchestrator-runtime/spec.md
 */

import { z } from "zod"
import type { ToolRegistry } from "@/platform/registry/toolRegistry"
import { InvalidToolArgsError } from "@/types/toolpack"
import { metaOf } from "./_registry"
import { getDispatcher } from "./_dispatcher"

// ─── Schemas ─────────────────────────────────────────────────────────

const GetAllTasks = z.object({
  filter: z
    .object({
      status: z.string().optional(),
      assignee: z.string().optional(),
    })
    .optional(),
})

const UpdateTaskStatus = z.object({
  taskId: z.string().min(1),
  status: z.enum(["pending", "in-progress", "done", "cancelled"]),
})

const SendWecomMessage = z.object({
  botId: z.string().min(1),
  content: z.string().min(1),
  toUser: z.string().optional(),
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

// ─── Registration ────────────────────────────────────────────────────

export function register(toolRegistry: ToolRegistry): void {
  // ── get_all_tasks ──────────────────────────────────────────────────
  toolRegistry.register(metaOf("get_all_tasks"), async (args, _ctx) => {
    const a = parse("get_all_tasks", GetAllTasks, args)

    // Dynamic import to avoid circular deps
    const { useTaskStore } = await import("@/stores/taskStore").catch(() => ({
      useTaskStore: null,
    }))

    if (!useTaskStore) {
      // Fallback: return empty list if taskStore not available
      return { tasks: [], total: 0 }
    }

    const store = useTaskStore.getState()
    let tasks = store.tasks ?? []

    // Apply filter if provided
    if (a.filter) {
      if (a.filter.status) {
        tasks = tasks.filter((t: any) => t.status === a.filter!.status)
      }
      if (a.filter.assignee) {
        tasks = tasks.filter((t: any) => t.meta?.assignee === a.filter!.assignee)
      }
    }

    return { tasks, total: tasks.length }
  })

  // ── update_task_status ─────────────────────────────────────────────
  toolRegistry.register(metaOf("update_task_status"), async (args, _ctx) => {
    const a = parse("update_task_status", UpdateTaskStatus, args)

    const { useTaskStore } = await import("@/stores/taskStore").catch(() => ({
      useTaskStore: null,
    }))

    if (!useTaskStore) {
      throw new Error("TASK_STORE_UNAVAILABLE: taskStore is not available")
    }

    const store = useTaskStore.getState()
    if (!store.updateTaskStatus) {
      throw new Error("TASK_STORE_NO_UPDATE: taskStore.updateTaskStatus is not implemented")
    }

    store.updateTaskStatus(a.taskId, a.status as any)

    // Emit event for listeners
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("task-changed", { detail: { taskId: a.taskId, status: a.status } }),
      )
    }

    return { success: true, taskId: a.taskId, newStatus: a.status }
  })

  // ── send_wecom_message ─────────────────────────────────────────────
  toolRegistry.register(metaOf("send_wecom_message"), async (args, ctx) => {
    const a = parse("send_wecom_message", SendWecomMessage, args)

    // Validate bot is in allowed list (read from env)
    const allowedBotsEnv = typeof process !== "undefined"
      ? process.env.WECOM_ALLOWED_BOTS ?? ""
      : ""
    const allowedBots = allowedBotsEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)

    if (allowedBots.length > 0 && !allowedBots.includes(a.botId)) {
      throw new Error(
        `WECOM_BOT_NOT_ALLOWED: bot "${a.botId}" is not in the allowed bots list. ` +
          `Allowed: [${allowedBots.join(", ")}]`,
      )
    }

    // Send via Rust http_post_json (goes through networkGuard)
    const webhookUrl = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${a.botId}`
    const body = {
      msgtype: "text",
      text: {
        content: a.content,
        ...(a.toUser ? { mentioned_list: [a.toUser] } : {}),
      },
    }

    return getDispatcher()("http_post_json", {
      sessionId: ctx.sessionId,
      url: webhookUrl,
      body: JSON.stringify(body),
    })
  })
}
