/**
 * orchestrator-toolpack.test.ts — Phase G Task 3.6
 *
 * Tests:
 *   get_all_tasks: happy / store-unavailable
 *   update_task_status: happy / store-unavailable
 *   send_wecom_message: happy / unauthorized bot / network-blocked (dispatcher throws)
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { toolRegistry } from "@/platform/registry/toolRegistry"
import { register } from "./orchestrator-toolpack"

// ─── Mocks ───────────────────────────────────────────────────────────

const mockTasks = [
  { id: "t1", status: "pending", meta: { assignee: "alice" } },
  { id: "t2", status: "done", meta: { assignee: "bob" } },
  { id: "t3", status: "in-progress", meta: { assignee: "alice" } },
]

const mockUpdateTaskStatus = vi.fn()

vi.mock("@/stores/taskStore", () => ({
  useTaskStore: {
    getState: () => ({
      tasks: mockTasks,
      updateTaskStatus: mockUpdateTaskStatus,
    }),
  },
}))

const mockDispatcher = vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok" })

vi.mock("./_dispatcher", () => ({
  getDispatcher: () => mockDispatcher,
}))

// ─── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  toolRegistry.clearForTest()
  register(toolRegistry)
  vi.clearAllMocks()
  // Set up WECOM_ALLOWED_BOTS env
  process.env.WECOM_ALLOWED_BOTS = "bot-001,bot-002"
})

const CTX = { sessionId: "orch-session-001", source: "builtin" as const }

// ─── get_all_tasks ───────────────────────────────────────────────────

describe("get_all_tasks", () => {
  it("happy: returns all tasks without filter", async () => {
    const result = (await toolRegistry.invoke("get_all_tasks", {}, CTX)) as any

    expect(result.tasks).toHaveLength(3)
    expect(result.total).toBe(3)
  })

  it("happy: filters by status", async () => {
    const result = (await toolRegistry.invoke(
      "get_all_tasks",
      { filter: { status: "pending" } },
      CTX,
    )) as any

    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].id).toBe("t1")
  })

  it("happy: filters by assignee", async () => {
    const result = (await toolRegistry.invoke(
      "get_all_tasks",
      { filter: { assignee: "alice" } },
      CTX,
    )) as any

    expect(result.tasks).toHaveLength(2)
    expect(result.tasks.every((t: any) => t.meta.assignee === "alice")).toBe(true)
  })
})

// ─── update_task_status ──────────────────────────────────────────────

describe("update_task_status", () => {
  it("happy: updates task status and emits event", async () => {
    const result = (await toolRegistry.invoke(
      "update_task_status",
      { taskId: "t1", status: "done" },
      CTX,
    )) as any

    expect(result).toMatchObject({
      success: true,
      taskId: "t1",
      newStatus: "done",
    })
    expect(mockUpdateTaskStatus).toHaveBeenCalledWith("t1", "done")
  })

  it("rejects invalid status enum", async () => {
    await expect(
      toolRegistry.invoke(
        "update_task_status",
        { taskId: "t1", status: "invalid-status" },
        CTX,
      ),
    ).rejects.toThrow()
  })
})

// ─── send_wecom_message ──────────────────────────────────────────────

describe("send_wecom_message", () => {
  it("happy: sends message via allowed bot", async () => {
    const result = await toolRegistry.invoke(
      "send_wecom_message",
      { botId: "bot-001", content: "Hello from orchestrator" },
      CTX,
    )

    expect(mockDispatcher).toHaveBeenCalledWith(
      "http_post_json",
      expect.objectContaining({
        sessionId: "orch-session-001",
        url: expect.stringContaining("qyapi.weixin.qq.com"),
      }),
    )
    expect(result).toMatchObject({ errcode: 0 })
  })

  it("rejects unauthorized bot (not in allowedBots)", async () => {
    await expect(
      toolRegistry.invoke(
        "send_wecom_message",
        { botId: "evil-bot", content: "hack" },
        CTX,
      ),
    ).rejects.toThrow("WECOM_BOT_NOT_ALLOWED")
  })

  it("propagates network error from dispatcher", async () => {
    mockDispatcher.mockRejectedValueOnce(new Error("NETWORK_BLOCKED: host not in allowlist"))

    await expect(
      toolRegistry.invoke(
        "send_wecom_message",
        { botId: "bot-001", content: "test" },
        CTX,
      ),
    ).rejects.toThrow("NETWORK_BLOCKED")
  })
})
