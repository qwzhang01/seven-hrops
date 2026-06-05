import { useState } from 'react'
import type { ToolStatus } from '@/types/chat'
import { TOOL_REGISTRY } from '@/tool-registry/toolpacks/_registry'

interface ToolCallBubbleProps {
  toolName: string
  toolArgs?: Record<string, unknown>
  toolResult?: unknown
  status: ToolStatus
}

const MAX_RESULT_LENGTH = 120

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str
}

/** Returns the progressLabel for a tool, or null if not defined. */
function getProgressLabel(toolName: string, status: ToolStatus): string | null {
  const meta = TOOL_REGISTRY[toolName]
  if (!meta?.progressLabel) return null
  if (status === 'pending') return meta.progressLabel
  if (status === 'done') {
    // Convert "正在解析 PDF..." → "PDF 解析完成 ✓"
    // Use a simple done suffix pattern
    return meta.progressLabel.replace(/^正在/, '').replace(/\.\.\.$/, '') + ' 完成 ✓'
  }
  return null
}

export function ToolCallBubble({ toolName, toolArgs, toolResult, status }: ToolCallBubbleProps) {
  const [expanded, setExpanded] = useState(false)

  const progressLabel = getProgressLabel(toolName, status)

  const resultStr = toolResult != null
    ? typeof toolResult === 'string'
      ? toolResult
      : JSON.stringify(toolResult)
    : ''

  return (
    <div
      style={{
        border: '1px solid var(--color-border, #334155)',
        borderRadius: 8,
        padding: '8px 12px',
        margin: '4px 0',
        background: 'var(--color-surface-secondary, #1e293b)',
        fontSize: 13,
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={() => setExpanded((v) => !v)}
      role="button"
      aria-expanded={expanded}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Status icon */}
        {status === 'pending' && (
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              border: '2px solid #60a5fa',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
            aria-label="loading"
          />
        )}
        {status === 'done' && (
          <span style={{ color: '#4ade80', fontWeight: 700 }} aria-label="done">✓</span>
        )}
        {status === 'error' && (
          <span style={{ color: '#f87171', fontWeight: 700 }} aria-label="error">✗</span>
        )}

        {/* Tool name or progressLabel */}
        {progressLabel ? (
          <span style={{ color: status === 'done' ? '#4ade80' : 'var(--color-text-secondary, #94a3b8)' }}>
            {progressLabel}
          </span>
        ) : (
          <span style={{ color: 'var(--color-text-secondary, #94a3b8)', fontFamily: 'monospace' }}>
            {toolName}
          </span>
        )}

        <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted, #64748b)', fontSize: 11 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Always show raw tool name in expanded view */}
          {progressLabel && (
            <div>
              <span style={{ color: 'var(--color-text-muted, #64748b)', fontSize: 11 }}>Tool: </span>
              <code style={{ color: 'var(--color-text-primary, #e2e8f0)', fontSize: 11, fontFamily: 'monospace' }}>
                {toolName}
              </code>
            </div>
          )}
          {toolArgs && (
            <div>
              <span style={{ color: 'var(--color-text-muted, #64748b)', fontSize: 11 }}>Args: </span>
              <code style={{ color: 'var(--color-text-primary, #e2e8f0)', fontSize: 11, wordBreak: 'break-all' }}>
                {JSON.stringify(toolArgs)}
              </code>
            </div>
          )}
          {status === 'done' && resultStr && (
            <div>
              <span style={{ color: 'var(--color-text-muted, #64748b)', fontSize: 11 }}>Result: </span>
              <code style={{ color: '#4ade80', fontSize: 11, wordBreak: 'break-all' }}>
                {truncate(resultStr, MAX_RESULT_LENGTH)}
              </code>
            </div>
          )}
          {status === 'error' && resultStr && (
            <div>
              <span style={{ color: '#f87171', fontSize: 11 }}>{resultStr}</span>
            </div>
          )}
        </div>
      )}

      {/* Collapsed summary for done state */}
      {!expanded && status === 'done' && resultStr && !progressLabel && (
        <div style={{ marginTop: 4, color: '#4ade80', fontSize: 11 }}>
          {truncate(resultStr, MAX_RESULT_LENGTH)}
        </div>
      )}
    </div>
  )
}
