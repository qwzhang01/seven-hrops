import type { ChatMessage } from '@/types/chat'
import { ToolCallBubble } from '../ToolCallBubble'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  if (message.type === 'tool-call') {
    return (
      <div style={{ padding: '2px 16px' }}>
        <ToolCallBubble
          toolName={message.toolName ?? 'unknown'}
          toolArgs={message.toolArgs}
          toolResult={message.toolResult}
          status={message.toolStatus ?? 'pending'}
        />
      </div>
    )
  }

  if (message.type === 'error') {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-start',
          padding: '4px 16px',
        }}
      >
        <div
          style={{
            maxWidth: '80%',
            padding: '10px 14px',
            borderRadius: 12,
            background: 'rgba(248, 113, 113, 0.15)',
            border: '1px solid rgba(248, 113, 113, 0.3)',
            color: '#f87171',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          ⚠ {message.content}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        padding: '4px 16px',
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '10px 14px',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          background: isUser
            ? 'var(--color-primary, #3b82f6)'
            : 'var(--color-surface-secondary, #1e293b)',
          color: isUser
            ? '#ffffff'
            : 'var(--color-text-primary, #e2e8f0)',
          fontSize: 14,
          lineHeight: 1.6,
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        {message.content || (message.role === 'assistant' ? '…' : '')}
      </div>
    </div>
  )
}
