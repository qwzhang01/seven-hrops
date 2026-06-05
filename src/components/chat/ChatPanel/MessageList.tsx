import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@/types/chat'
import { MessageBubble } from './MessageBubble'
import { DelegateBubble } from './DelegateBubble'

interface MessageListProps {
  messages: ChatMessage[]
  isTyping: boolean
  /** Phase G: Child session messages keyed by sessionId, for delegate bubble rendering. */
  delegateMessages?: Record<string, ChatMessage[]>
}

export function MessageList({ messages, isTyping, delegateMessages = {} }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {messages.length === 0 && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-muted, #64748b)',
            fontSize: 14,
          }}
        >
          发送消息开始对话
        </div>
      )}

      {messages.map((msg) => (
        <div key={msg.id}>
          <MessageBubble message={msg} />
          {msg.metadata?.delegateChildSessionId && (
            <DelegateBubble
              parentMessage={msg}
              childMessages={delegateMessages[msg.metadata.delegateChildSessionId]}
            />
          )}
        </div>
      ))}

      {isTyping && (
        <div style={{ padding: '4px 16px' }}>
          <div
            style={{
              display: 'inline-flex',
              gap: 4,
              padding: '10px 14px',
              borderRadius: '18px 18px 18px 4px',
              background: 'var(--color-surface-secondary, #1e293b)',
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--color-text-muted, #64748b)',
                  display: 'inline-block',
                  animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
