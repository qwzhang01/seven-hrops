/**
 * Tests for PlatformBootError (Phase B Task 6.6).
 *
 * Light coverage: this is a degraded-mode UI, so we only assert that
 * essential affordances render correctly (error code, retry button,
 * collapsible stack). Tauri-specific buttons are smoke-tested but their
 * actual IPC isn't (jsdom can't load `@tauri-apps/api`).
 */

import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PlatformBootError } from "./PlatformBootError"

describe("PlatformBootError", () => {
  it("extracts the structured error code from a ValidationError-like object", () => {
    const err = Object.assign(new Error("bad agent"), {
      code: "TOOL_NOT_PERMITTED_FOR_SOURCE",
    })
    render(<PlatformBootError error={err} />)
    expect(
      screen.getByText("TOOL_NOT_PERMITTED_FOR_SOURCE"),
    ).toBeInTheDocument()
  })

  it("falls back to UNKNOWN when the error has no `code`", () => {
    render(<PlatformBootError error={new Error("plain")} />)
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument()
  })

  it("renders the retry button only when onRetry is provided", () => {
    const { rerender } = render(
      <PlatformBootError error={new Error("x")} />,
    )
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull()
    const onRetry = vi.fn()
    rerender(<PlatformBootError error={new Error("x")} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("toggles the stack section on click", () => {
    const err = new Error("boom")
    err.stack = "Error: boom\n    at line 1"
    render(<PlatformBootError error={err} />)
    expect(screen.queryByText(/at line 1/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "展开堆栈" }))
    expect(screen.getByText(/at line 1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "收起堆栈" }))
    expect(screen.queryByText(/at line 1/)).toBeNull()
  })

  it("renders the open-audit-log button regardless of error shape", () => {
    render(<PlatformBootError error="just a string" />)
    expect(
      screen.getByRole("button", { name: "打开审计日志" }),
    ).toBeInTheDocument()
  })
})
