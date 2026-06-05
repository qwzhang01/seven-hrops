import { useEffect, useRef, useState } from 'react'
import { useAIStore } from '@/stores/aiStore'
import { useCapabilityStore } from '@/stores/capabilityStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useMessageStore } from '@/stores/messageStore'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import type { ChatMessage } from '@/types/chat'

// ─── Phase G Task 10.2: Delegate view tab types ───────────────────────

type ViewMode = 'dispatch' | 'business'

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Check if any message in the list has a delegate child session. */
function hasDelegateMessages(messages: ChatMessage[]): boolean {
  return messages.some((m) => !!m.metadata?.delegateChildSessionId)
}

// ─── Component ───────────────────────────────────────────────────────────

export function ChatPanel() {
  // ── AI Store ──────────────────────────────────────────────────────────
  const messages = useAIStore((s) => s.messages)
  const isTyping = useAIStore((s) => s.isTyping)
  const sendMessage = useAIStore((s) => s.sendMessage)
  const setAIActiveSessionId = useAIStore((s) => s.setActiveSessionId)
  const clearAIMessages = useAIStore((s) => s.clearMessages)

  // ── Capability Store ──────────────────────────────────────────────────
  const activeCapabilityId = useCapabilityStore((s) => s.activeCapabilityId)
  const getActiveCapability = useCapabilityStore((s) => s.getActive)

  // ── Session Store (Phase 6) ────────────────────────────────────────
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const createSession = useSessionStore((state) => state.createSession)
  const setActiveSession = useSessionStore((state) => state.setActiveSession)
  const generateTitle = useSessionStore((state) => state.generateTitle)

  const activeSession = useSessionStore((state) =>
    state.sessions.find((s) => s.id === state.activeSessionId) ?? null
  )

  // ── Message Store (Phase 6) ────────────────────────────────────────
  const addMessage = useMessageStore((state) => state.addMessage)
  const loadMessages = useMessageStore((state) => state.loadMessages)

  // Track if this is the first message (for title generation)
  const isFirstMessage = messages.length === 0

  // ── Load messages when active session changes (Phase 6) ─────────────
  useEffect(() => {
    if (!activeSessionId) {
      // No active session, clear messages
      clearAIMessages()
      setAIActiveSessionId(null)
      return
    }

    // Immediately clear stale messages and update session ID so the UI
    // reflects the switch right away instead of showing the previous session's content
    clearAIMessages()
    setAIActiveSessionId(activeSessionId)

    // Load messages from DB for this session
    let cancelled = false
    const loadSessionMessages = async () => {
      try {
        // Always load from DB to ensure fresh data on session switch
        await loadMessages(activeSessionId)

        // Guard against race condition: user switched again before this load completed
        if (cancelled) return

        // Read latest state directly after async load (avoid stale closure)
        const sessionMessages = useMessageStore.getState().getMessagesForSession(activeSessionId)

        // Convert DB messages to ChatMessage format and update aiStore
        const chatMessages: ChatMessage[] = sessionMessages.map((msg) => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant' | 'system',
          type: 'text' as const,
          content: msg.content,
          timestamp: new Date(msg.created_at).getTime(),
        }))

        // Replace aiStore messages with loaded messages
        useAIStore.setState({ messages: chatMessages })
      } catch (error) {
        console.error('[ChatPanel] Failed to load session messages:', error)
      }
    }

    loadSessionMessages()

    // Cleanup: if activeSessionId changes again before load completes, discard result
    return () => { cancelled = true }
  }, [activeSessionId])

  // Phase G Task 9.5: briefly disable input on capability switch (100ms)
  const [switchLock, setSwitchLock] = useState(false)
  const prevCapRef = useRef(activeCapabilityId)
  useEffect(() => {
    if (prevCapRef.current !== activeCapabilityId && prevCapRef.current !== null) {
      setSwitchLock(true)
      const timer = setTimeout(() => setSwitchLock(false), 100)
      return () => clearTimeout(timer)
    }
    prevCapRef.current = activeCapabilityId
  }, [activeCapabilityId])

  // Task 7.2 (session-workspace-binding): briefly disable input on session switch (100ms)
  // Prevents accidental message sends during the session transition.
  // Task 9.3: also apply a brief fade-out/in transition on the message area.
  const [sessionSwitching, setSessionSwitching] = useState(false)
  const prevSessionRef = useRef(activeSessionId)
  useEffect(() => {
    if (prevSessionRef.current !== activeSessionId && prevSessionRef.current !== null) {
      setSwitchLock(true)
      setSessionSwitching(true)
      const lockTimer = setTimeout(() => setSwitchLock(false), 100)
      const animTimer = setTimeout(() => setSessionSwitching(false), 80)
      prevSessionRef.current = activeSessionId
      return () => {
        clearTimeout(lockTimer)
        clearTimeout(animTimer)
      }
    }
    prevSessionRef.current = activeSessionId
  }, [activeSessionId])

  // Phase G Task 10.2: dispatch/business view tab
  const [viewMode, setViewMode] = useState<ViewMode>('dispatch')
  const showViewTabs = hasDelegateMessages(messages)

  // Filter messages based on view mode:
  // - dispatch: show all messages (assistant's scheduling record)
  // - business: show only non-delegate messages (clean business conversation)
  const displayMessages =
    viewMode === 'business'
      ? messages.filter((m) => !m.metadata?.delegateChildSessionId)
      : messages

  // arch-capability-agent-contract: refuse to send when no capability
  // is active. Disable the input + show a hint placeholder so the user
  // doesn't trigger the silent guard inside aiStore.sendMessage.
  const noCapability = !activeCapabilityId
  const inputDisabled = isTyping || noCapability || switchLock
  const inputPlaceholder = noCapability
    ? '请先在左侧选择一个能力'
    : undefined

  // ── Handle Send Message (Phase 6) ───────────────────────────────────
  const handleSend = async (text: string) => {
    if (!activeCapabilityId) return

    let sessionId = activeSessionId

    // If no active session, create one
    if (!sessionId) {
      const capability = getActiveCapability()
      // capability.name 不存在，使用 id 或 manifest.metadata.name
      const session = await createSession(activeCapabilityId, capability?.manifest.metadata.name ?? capability?.id ?? '未知能力')
      sessionId = session.id
    }

    // Send message (aiStore.sendMessage will handle the API call)
    void sendMessage(text, activeCapabilityId)

    // If this is the first message, generate title after a delay
    if (isFirstMessage && sessionId) {
      // Wait for the message to be processed, then generate title
      setTimeout(() => {
        generateTitle(sessionId!, text)
      }, 2000)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-surface, #0f172a)',
        overflow: 'hidden',
      }}
    >
      {/* ── Session Capability Tag (Phase 6) ────────────────────────── */}
      {activeSession?.capability_name && (
        <div
          data-testid="session-capability-tag"
          style={{
            padding: '6px 16px',
            borderBottom: '1px solid var(--color-border, #1e293b)',
            fontSize: 12,
            color: 'var(--color-text-tertiary, #64748b)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>🤖</span>
          <span>{activeSession.capability_name}</span>
        </div>
      )}

      {/* Phase G Task 10.2: View mode tabs — only shown when delegate sub-flows exist */}
      {showViewTabs && (
        <div
          data-testid="delegate-view-tabs"
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--color-border, #1e293b)',
            padding: '0 16px',
            gap: 0,
          }}
        >
          {(['dispatch', 'business'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              data-testid={`delegate-tab-${mode}`}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '8px 16px',
                background: 'none',
                border: 'none',
                borderBottom: viewMode === mode
                  ? '2px solid var(--color-primary, #3b82f6)'
                  : '2px solid transparent',
                color: viewMode === mode
                  ? 'var(--color-text-primary, #e2e8f0)'
                  : 'var(--color-text-muted, #64748b)',
                fontSize: 13,
                fontWeight: viewMode === mode ? 500 : 400,
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {mode === 'dispatch' ? '调度视图' : '业务视图'}
            </button>
          ))}
        </div>
      )}

      {/* Task 9.3: wrapper div for session-switch fade transition (≤80ms) */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          opacity: sessionSwitching ? 0 : 1,
          transition: 'opacity 80ms ease',
        }}
      >
        <MessageList messages={displayMessages} isTyping={isTyping} />
      </div>
      {/* key={activeSessionId} causes React to remount ChatInput on session switch,
          which resets the internal `value` state — clearing the input box.
          Spec reference: openspec/changes/use_def/session-workspace-binding/tasks.md §7.1 */}
      <ChatInput
        key={activeSessionId ?? 'no-session'}
        onSend={handleSend}
        disabled={inputDisabled}
        placeholder={inputPlaceholder}
      />
    </div>
  )
}
