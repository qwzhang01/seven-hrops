export type ChatRole = 'user' | 'assistant' | 'system'
export type ChatMessageType = 'text' | 'tool-call' | 'tool-result' | 'error'
export type ToolStatus = 'pending' | 'done' | 'error'

/** Phase G: Message metadata for delegate sub-session embedding. */
export interface ChatMessageMetadata {
  /** If set, this message triggered a delegate sub-session. UI renders a DelegateBubble. */
  delegateChildSessionId?: string
  /** The agent name that handled the delegate sub-session. */
  delegateAgentName?: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  type: ChatMessageType
  content: string
  timestamp: number
  // tool-call / tool-result specific fields
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: unknown
  toolStatus?: ToolStatus
  /** Phase G: Optional metadata for delegate sub-session embedding. */
  metadata?: ChatMessageMetadata
}
