import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toolRegistry } from "@/platform/registry/toolRegistry"
import { resetDispatcher, setDispatcher } from "./_dispatcher"
import { register } from "./export-toolpack"

const ctx = { sessionId: "session-1", source: "builtin" as const }

describe("export-toolpack", () => {
  beforeEach(() => {
    toolRegistry.clearForTest()
  })

  afterEach(() => {
    resetDispatcher()
    toolRegistry.clearForTest()
  })

  it("registers export_to_word", () => {
    register(toolRegistry)

    expect(toolRegistry.has("export_to_word")).toBe(true)
    expect(toolRegistry.get("export_to_word")?.category).toBe("write")
  })

  it("forwards export_to_word args to export_docx dispatcher", async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true })
    setDispatcher(dispatch)
    register(toolRegistry)

    const result = await toolRegistry.invoke(
      "export_to_word",
      { path: "/tmp/report.docx", content: "hello" },
      ctx,
    )

    expect(result).toEqual({ ok: true })
    expect(dispatch).toHaveBeenCalledWith("export_docx", {
      sessionId: "session-1",
      path: "/tmp/report.docx",
      content: "hello",
    })
  })

  it("rejects invalid export_to_word args", async () => {
    register(toolRegistry)

    await expect(
      toolRegistry.invoke("export_to_word", { path: "" }, ctx),
    ).rejects.toThrow(/export_to_word/)
  })

  it("keeps export_to_html delegated to fs_write_text", async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true })
    setDispatcher(dispatch)
    register(toolRegistry)

    await toolRegistry.invoke(
      "export_to_html",
      { path: "/tmp/report.html", html: "<h1>ok</h1>" },
      ctx,
    )

    expect(dispatch).toHaveBeenCalledWith("fs_write_text", {
      sessionId: "session-1",
      path: "/tmp/report.html",
      content: "<h1>ok</h1>",
    })
  })
})
