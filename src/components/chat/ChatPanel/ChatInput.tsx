import { useState, useRef, type KeyboardEvent } from 'react'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  return (
    <div
      style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--color-border, #334155)',
        background: 'var(--color-surface, #0f172a)',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-end',
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder={placeholder ?? "输入消息，Enter 发送，Shift+Enter 换行"}
        disabled={disabled}
        rows={1}
        style={{
          flex: 1,
          resize: 'none',
          background: 'var(--color-surface-secondary, #1e293b)',
          border: '1px solid var(--color-border, #334155)',
          borderRadius: 12,
          padding: '10px 14px',
          color: 'var(--color-text-primary, #e2e8f0)',
          fontSize: 14,
          lineHeight: 1.5,
          outline: 'none',
          fontFamily: 'inherit',
          minHeight: 42,
          maxHeight: 160,
          overflowY: 'auto',
        }}
      />
      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        style={{
          padding: '10px 18px',
          borderRadius: 12,
          border: 'none',
          background: disabled || !value.trim()
            ? 'var(--color-surface-secondary, #1e293b)'
            : 'var(--color-primary, #3b82f6)',
          color: disabled || !value.trim()
            ? 'var(--color-text-muted, #64748b)'
            : '#ffffff',
          fontSize: 14,
          fontWeight: 600,
          cursor: disabled || !value.trim() ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s, color 0.15s',
          flexShrink: 0,
          height: 42,
        }}
      >
        发送
      </button>
    </div>
  )
}
