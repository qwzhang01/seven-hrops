import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ToolCallBubble } from "./ToolCallBubble"

describe("ToolCallBubble", () => {
  it("shows parse_pdf pending progress label", () => {
    render(<ToolCallBubble toolName="parse_pdf" status="pending" />)

    expect(screen.getByText("正在解析 PDF...")).toBeInTheDocument()
    expect(screen.getByLabelText("loading")).toBeInTheDocument()
  })

  it("shows export_to_html done progress label", () => {
    render(<ToolCallBubble toolName="export_to_html" status="done" />)

    expect(screen.getByText("生成 HTML 报告 完成 ✓")).toBeInTheDocument()
    expect(screen.getByLabelText("done")).toBeInTheDocument()
  })

  it("shows raw tool name in expanded view when using progressLabel", () => {
    render(<ToolCallBubble toolName="parse_docx" status="pending" />)

    fireEvent.click(screen.getByRole("button"))

    expect(screen.getByText("Tool:")).toBeInTheDocument()
    expect(screen.getByText("parse_docx")).toBeInTheDocument()
  })

  it("falls back to the tool name when no progressLabel exists", () => {
    render(<ToolCallBubble toolName="read_file" status="pending" />)

    expect(screen.getByText("read_file")).toBeInTheDocument()
  })
})
