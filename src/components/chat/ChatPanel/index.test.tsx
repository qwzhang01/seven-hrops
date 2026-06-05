/**
 * Tests for ChatPanel — capability-gated send button.
 *
 * Spec reference:
 *   - openspec/changes/arch-capability-agent-contract/tasks.md §5
 *   - openspec/changes/arch-capability-agent-contract/specs/ai-store-chat/spec.md
 */

import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatPanel } from "./index"
import { useAIStore } from "@/stores/aiStore"
import { useCapabilityStore } from "@/stores/capabilityStore"
import { useSessionStore } from "@/stores/sessionStore"
import { useMessageStore } from "@/stores/messageStore"

// jsdom does not implement scrollIntoView; stub it for MessageList's
// auto-scroll effect.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// We don't want the real chatWithStream to run — we only care about
// whether sendMessage was called with the right capabilityId. Replace
// the store action with a spy in each test.

const resetStores = () => {
  useAIStore.setState({
    messages: [],
    isTyping: false,
    activeSessionId: null,
  })
  useCapabilityStore.setState({
    records: [],
    activeCapabilityId: null,
    isLoading: false,
    error: null,
  })
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    loading: false,
    hasMore: true,
    totalSessions: 0,
    currentPage: 1,
  })
}

beforeEach(resetStores)
afterEach(resetStores)

describe("ChatPanel — capability gate", () => {
  it("disables the send button and shows the hint placeholder when no capability is active", () => {
    render(<ChatPanel />)

    const sendButton = screen.getByRole("button", { name: /发送/ })
    expect(sendButton).toBeDisabled()

    const textarea = screen.getByPlaceholderText("请先在左侧选择一个能力")
    expect(textarea).toBeDisabled()
  })

  it("enables the input when a capability is active and forwards capabilityId on send", () => {
    useCapabilityStore.setState({
      records: [],
      activeCapabilityId: "resume-screening",
      isLoading: false,
      error: null,
    })
    // Set an active session so handleSend doesn't call createSession → invoke
    useSessionStore.setState({ activeSessionId: "session-test" })

    const sendSpy = vi.fn(async () => {})
    useAIStore.setState({ sendMessage: sendSpy as any })

    render(<ChatPanel />)

    const textarea = screen.getByPlaceholderText(
      "输入消息，Enter 发送，Shift+Enter 换行",
    ) as HTMLTextAreaElement

    expect(textarea).not.toBeDisabled()

    fireEvent.change(textarea, { target: { value: "你好" } })
    const sendButton = screen.getByRole("button", { name: /发送/ })
    expect(sendButton).not.toBeDisabled()

    fireEvent.click(sendButton)

    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy).toHaveBeenCalledWith("你好", "resume-screening")
  })
})

// ─── Task 7.3: session-workspace-binding — session switching tests ────

describe("ChatPanel — session switching", () => {
  it("clears messages when activeSessionId changes to null", () => {
    // Start with an active session and some messages
    useAIStore.setState({
      messages: [
        { id: "m1", role: "user", type: "text", content: "旧消息", timestamp: Date.now() },
      ],
      activeSessionId: "session-old",
    })
    useSessionStore.setState({ activeSessionId: "session-old" })
    useCapabilityStore.setState({ activeCapabilityId: "resume-screening" })

    const { rerender } = render(<ChatPanel />)

    // Switch to no session
    useSessionStore.setState({ activeSessionId: null })
    rerender(<ChatPanel />)

    // Messages should be cleared (clearAIMessages called)
    expect(useAIStore.getState().messages).toEqual([])
  })

  it("input box is remounted (cleared) when activeSessionId changes", () => {
    useCapabilityStore.setState({ activeCapabilityId: "resume-screening" })
    useSessionStore.setState({ activeSessionId: "session-a" })

    const { rerender } = render(<ChatPanel />)

    // Type something in the input
    const textarea = screen.getByPlaceholderText(
      "输入消息，Enter 发送，Shift+Enter 换行",
    ) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: "未发送的内容" } })
    expect(textarea.value).toBe("未发送的内容")

    // Switch to another session — ChatInput is remounted via key={activeSessionId}
    useSessionStore.setState({ activeSessionId: "session-b" })
    rerender(<ChatPanel />)

    // The new textarea should be empty (remounted)
    const newTextarea = screen.getByPlaceholderText(
      "输入消息，Enter 发送，Shift+Enter 换行",
    ) as HTMLTextAreaElement
    expect(newTextarea.value).toBe("")
  })
})
