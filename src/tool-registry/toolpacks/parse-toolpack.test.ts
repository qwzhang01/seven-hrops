/**
 * parse-toolpack tests — Phase F Task 2.7
 *
 * Tests for transcribe_audio invoker (mock dispatcher).
 * These tests are written now but may not pass until Phase G when the
 * full FFI pipeline is wired end-to-end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toolRegistry } from "@/platform/registry/toolRegistry"
import { resetDispatcher, setDispatcher } from "./_dispatcher"
import { register } from "./parse-toolpack"

const builtinCtx = { sessionId: "session-1", source: "builtin" as const }
const userCtx = { sessionId: "session-2", source: "user" as const }

describe("parse-toolpack: transcribe_audio", () => {
  beforeEach(() => {
    toolRegistry.clearForTest()
  })

  afterEach(() => {
    resetDispatcher()
    toolRegistry.clearForTest()
  })

  it("registers transcribe_audio with correct metadata", () => {
    register(toolRegistry)

    expect(toolRegistry.has("transcribe_audio")).toBe(true)
    const meta = toolRegistry.get("transcribe_audio")
    expect(meta?.category).toBe("parse")
    expect(meta?.riskLevel).toBe("medium")
    expect(meta?.defaultAllowedSources).toEqual(["builtin"])
  })

  // Scenario 1: FFI ready — successful transcription
  it("forwards transcribe_audio args to dispatcher on success", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      text: "你好世界",
      segments: [{ start: 0, end: 1.5, text: "你好世界" }],
    })
    setDispatcher(dispatch)
    register(toolRegistry)

    const result = await toolRegistry.invoke(
      "transcribe_audio",
      { path: "/workspace/01_inputs/audio/interview.wav" },
      builtinCtx,
    )

    expect(result).toEqual({
      text: "你好世界",
      segments: [{ start: 0, end: 1.5, text: "你好世界" }],
    })
    expect(dispatch).toHaveBeenCalledWith("transcribe_audio", {
      sessionId: "session-1",
      path: "/workspace/01_inputs/audio/interview.wav",
      lang: "zh",
    })
  })

  // Scenario 2: Sandbox deny — user-source agent cannot use transcribe_audio
  it("denies user-source agents from using transcribe_audio", async () => {
    register(toolRegistry)

    await expect(
      toolRegistry.invoke(
        "transcribe_audio",
        { path: "/workspace/audio.wav" },
        userCtx,
      ),
    ).rejects.toThrow(/TOOL_NOT_PERMITTED_FOR_SOURCE/)
  })

  // Scenario 3: Model not ready — dispatcher propagates error code
  it("propagates FFI_NOT_IMPLEMENTED error from dispatcher", async () => {
    const dispatch = vi.fn().mockRejectedValue(
      new Error("FFI_NOT_IMPLEMENTED: whisper-rs not available in this build"),
    )
    setDispatcher(dispatch)
    register(toolRegistry)

    await expect(
      toolRegistry.invoke(
        "transcribe_audio",
        { path: "/workspace/audio.wav" },
        builtinCtx,
      ),
    ).rejects.toThrow(/FFI_NOT_IMPLEMENTED/)
  })

  it("propagates WHISPER_MODEL_DOWNLOADING error from dispatcher", async () => {
    const dispatch = vi.fn().mockRejectedValue(
      new Error("WHISPER_MODEL_DOWNLOADING: model download in progress"),
    )
    setDispatcher(dispatch)
    register(toolRegistry)

    await expect(
      toolRegistry.invoke(
        "transcribe_audio",
        { path: "/workspace/audio.wav" },
        builtinCtx,
      ),
    ).rejects.toThrow(/WHISPER_MODEL_DOWNLOADING/)
  })

  it("defaults lang to 'zh' when not provided", async () => {
    const dispatch = vi.fn().mockResolvedValue({ text: "", segments: [] })
    setDispatcher(dispatch)
    register(toolRegistry)

    await toolRegistry.invoke(
      "transcribe_audio",
      { path: "/workspace/audio.wav" },
      builtinCtx,
    )

    expect(dispatch).toHaveBeenCalledWith("transcribe_audio", {
      sessionId: "session-1",
      path: "/workspace/audio.wav",
      lang: "zh",
    })
  })

  it("passes custom lang when provided", async () => {
    const dispatch = vi.fn().mockResolvedValue({ text: "", segments: [] })
    setDispatcher(dispatch)
    register(toolRegistry)

    await toolRegistry.invoke(
      "transcribe_audio",
      { path: "/workspace/audio.wav", lang: "en" },
      builtinCtx,
    )

    expect(dispatch).toHaveBeenCalledWith("transcribe_audio", {
      sessionId: "session-1",
      path: "/workspace/audio.wav",
      lang: "en",
    })
  })

  it("rejects invalid args (empty path)", async () => {
    register(toolRegistry)

    await expect(
      toolRegistry.invoke("transcribe_audio", { path: "" }, builtinCtx),
    ).rejects.toThrow(/transcribe_audio/)
  })
})
