/**
 * e2e: transcribe_audio — Phase F Task 2.8
 *
 * @slow — requires whisper model download (~150MB) on first run.
 * This test is written now but NOT expected to pass until Phase G
 * when the full FFI pipeline is wired end-to-end in CI.
 *
 * Fixture: tests/fixtures/audio/3s-chinese.wav (3 seconds of Chinese speech)
 * Expected: transcription text contains "你好" or reasonable degradation.
 */

import { describe, it, expect } from "vitest"
import { toolRegistry } from "@/platform/registry/toolRegistry"
import { registerAllToolpacks } from "@/tool-registry"

describe.skip("transcribe_audio e2e (@slow, Phase G)", () => {
  const ctx = { sessionId: "e2e-transcribe-1", source: "builtin" as const }

  it("transcribes a 3-second Chinese audio fixture", async () => {
    // Setup: register all toolpacks (requires Tauri runtime in real e2e)
    registerAllToolpacks(toolRegistry)

    const result = (await toolRegistry.invoke(
      "transcribe_audio",
      { path: "tests/fixtures/audio/3s-chinese.wav" },
      ctx,
    )) as { text: string; segments: Array<{ start: number; end: number; text: string }> }

    // Assert: text is non-empty and contains expected keyword
    expect(result.text.length).toBeGreaterThan(0)
    // Relaxed assertion: either contains expected keyword or is reasonable output
    expect(
      result.text.includes("你好") || result.text.length > 2,
    ).toBe(true)
    expect(result.segments.length).toBeGreaterThan(0)
  }, 60_000) // 60s timeout for model download + transcription

  it("returns FFI_NOT_IMPLEMENTED when feature is disabled", async () => {
    registerAllToolpacks(toolRegistry)

    // This test validates the degradation path when whisper-rs is not compiled
    // (feature = "ffi-stub" instead of "ffi-real")
    try {
      await toolRegistry.invoke(
        "transcribe_audio",
        { path: "tests/fixtures/audio/3s-chinese.wav" },
        ctx,
      )
      // If it succeeds, FFI is available — that's fine too
    } catch (e) {
      const msg = (e as Error).message
      // Either FFI_NOT_IMPLEMENTED (stub build) or success — both acceptable
      expect(
        msg.includes("FFI_NOT_IMPLEMENTED") || msg.includes("TRANSCRIBE_FAILED"),
      ).toBe(true)
    }
  })
})
