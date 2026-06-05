/**
 * DelegateBubble — Phase G Task 10.1
 *
 * Renders an indented sub-conversation block when a message has
 * `metadata.delegateChildSessionId`. Shows the delegate agent's
 * conversation inline within the parent session's message list.
 */

import { useState } from "react"
import type { ChatMessage } from "@/types/chat"

interface DelegateBubbleProps {
  /** The parent message that triggered the delegate. */
  parentMessage: ChatMessage
  /** Messages from the child session (passed in by MessageList). */
  childMessages?: ChatMessage[]
}

export function DelegateBubble({ parentMessage, childMessages = [] }: DelegateBubbleProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const agentName = parentMessage.metadata?.delegateAgentName ?? "子 Agent"

  return (
    <div
      data-testid="delegate-bubble"
      style={{
        marginLeft: 32,
        marginTop: 4,
        marginBottom: 4,
        borderLeft: "2px solid var(--color-primary-muted, #1e40af)",
        paddingLeft: 12,
      }}
    >
      {/* Header */}
      <button
        data-testid="delegate-bubble-toggle"
        onClick={() => setIsExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 0",
          color: "var(--color-text-muted, #64748b)",
          fontSize: 12,
        }}
      >
        <span style={{ fontSize: 10 }}>{isExpanded ? "▼" : "▶"}</span>
        <span>委派给「{agentName}」</span>
        {childMessages.length > 0 && (
          <span style={{ opacity: 0.6 }}>({childMessages.length} 条消息)</span>
        )}
      </button>

      {/* Child messages */}
      {isExpanded && (
        <div
          data-testid="delegate-bubble-content"
          style={{
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {childMessages.length === 0 ? (
            <div
              style={{
                color: "var(--color-text-muted, #64748b)",
                fontSize: 12,
                fontStyle: "italic",
              }}
            >
              子 Agent 处理中...
            </div>
          ) : (
            childMessages.map((msg) => (
              <div
                key={`delegate-${msg.id}`}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  background:
                    msg.role === "user"
                      ? "var(--color-surface-tertiary, #0f172a)"
                      : "var(--color-surface-secondary, #1e293b)",
                  fontSize: 13,
                  color: "var(--color-text-secondary, #94a3b8)",
                  maxWidth: "80%",
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <span style={{ opacity: 0.5, fontSize: 11, marginRight: 6 }}>
                  [{msg.role === "user" ? "用户" : agentName}]
                </span>
                {msg.content}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
