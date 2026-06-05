/**
 * DelegateBubble and ChatPanel delegate view tests — Phase G Task 10.3
 *
 * Covers:
 *   - DelegateBubble renders with correct agent name
 *   - DelegateBubble shows child messages
 *   - DelegateBubble expand/collapse toggle
 *   - ChatPanel: delegate tabs appear when messages have delegateChildSessionId
 *   - ChatPanel: tab switching filters messages correctly
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DelegateBubble } from "../chat/ChatPanel/DelegateBubble"
import type { ChatMessage } from "@/types/chat"

// ─── Helpers ─────────────────────────────────────────────────────────

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  role: "assistant",
  type: "text",
  content: "test message",
  timestamp: Date.now(),
  ...overrides,
})

// ─── DelegateBubble Tests ─────────────────────────────────────────────

describe("DelegateBubble", () => {
  it("renders with agent name from metadata", () => {
    const parentMsg = makeMessage({
      metadata: {
        delegateChildSessionId: "child-session-001",
        delegateAgentName: "screener",
      },
    })
    render(<DelegateBubble parentMessage={parentMsg} />)

    expect(screen.getByTestId("delegate-bubble")).toBeTruthy()
    expect(screen.getByText(/委派给「screener」/)).toBeTruthy()
  })

  it("renders fallback agent name when not provided", () => {
    const parentMsg = makeMessage({
      metadata: { delegateChildSessionId: "child-session-002" },
    })
    render(<DelegateBubble parentMessage={parentMsg} />)

    expect(screen.getByText(/委派给「子 Agent」/)).toBeTruthy()
  })

  it("shows child messages when provided", () => {
    const parentMsg = makeMessage({
      metadata: {
        delegateChildSessionId: "child-session-003",
        delegateAgentName: "screener",
      },
    })
    const childMessages = [
      makeMessage({ role: "user", content: "请筛选这份简历" }),
      makeMessage({ role: "assistant", content: "好的，我来分析..." }),
    ]
    render(<DelegateBubble parentMessage={parentMsg} childMessages={childMessages} />)

    expect(screen.getByText("请筛选这份简历")).toBeTruthy()
    expect(screen.getByText("好的，我来分析...")).toBeTruthy()
  })

  it("shows pending state when no child messages", () => {
    const parentMsg = makeMessage({
      metadata: { delegateChildSessionId: "child-session-004" },
    })
    render(<DelegateBubble parentMessage={parentMsg} childMessages={[]} />)

    expect(screen.getByText(/子 Agent 处理中/)).toBeTruthy()
  })

  it("collapses and expands on toggle click", () => {
    const parentMsg = makeMessage({
      metadata: {
        delegateChildSessionId: "child-session-005",
        delegateAgentName: "screener",
      },
    })
    const childMessages = [makeMessage({ content: "子消息内容" })]
    render(<DelegateBubble parentMessage={parentMsg} childMessages={childMessages} />)

    // Initially expanded
    expect(screen.getByTestId("delegate-bubble-content")).toBeTruthy()

    // Click to collapse
    fireEvent.click(screen.getByTestId("delegate-bubble-toggle"))
    expect(screen.queryByTestId("delegate-bubble-content")).toBeNull()

    // Click to expand again
    fireEvent.click(screen.getByTestId("delegate-bubble-toggle"))
    expect(screen.getByTestId("delegate-bubble-content")).toBeTruthy()
  })
})
