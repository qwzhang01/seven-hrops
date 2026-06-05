import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelProvider, ModelConnectionStatus } from '@/types';
import type {
  ProtocolID,
  PromptStyleID,
  DynamicPackage,
} from '@/agent-runtime/provider/_types';
import { getPlatformAPI } from '@/platform/bootstrap';
import { loadRuntimeConfig } from '@/platform/runtimeConfig';
import type { ChatMessage } from '@/types/chat';
import { withStreaming } from '@/stores/_internal/withStreaming';
import {
  CapabilityNotFoundError,
  CapabilityDisabledError,
} from '@/platform/registry';
import { SessionAgentMismatchError } from '@/agent-runtime/session/session';
import { useSessionStore } from '@/stores/sessionStore';
import { useMessageStore } from '@/stores/messageStore';

// ─── Types ───────────────────────────────────────────────────────────

export interface AIModelConfig {
  providerID: ModelProvider;
  modelID: string;
  apiKey?: string;
  baseURL?: string;
  /**
   * Optional protocol override. When `undefined`, the registry uses the
   * plugin's `defaultProtocol`. Required when `providerID === "dynamic"`
   * (dynamic providers have no plugin-supplied default).
   */
  protocol?: ProtocolID;
  /**
   * Prompt-style tool-call decorator. Three-state:
   *  - `undefined` → follow the plugin's default (e.g. volcengine → "doubao")
   *  - `null`      → explicitly disable the decorator
   *  - `"doubao" | "qwen"` → explicit override
   */
  promptStyle?: PromptStyleID | null;
  /**
   * Required when `providerID === "dynamic"`. npm package name in the
   * `@ai-sdk/<name>` family that supplies a `createXxx` factory at load time.
   */
  dynamicPackage?: DynamicPackage;
}

export interface AIAgentStatus {
  status: 'idle' | 'running' | 'error';
  currentAgent?: string;
  sessionID?: string;
  error?: string;
}

export interface AIStoreState {
  // Model configuration
  modelConfig: AIModelConfig;
  connectionStatus: ModelConnectionStatus;
  agents: Record<string, AIAgentStatus>;

  // Chat state
  messages: ChatMessage[];
  isTyping: boolean;
  activeSessionId: string | null;

  // Actions — Model
  /**
   * Update the model config and trigger a runtime reload so the new
   * provider/model/key takes effect immediately. Awaiting the returned
   * promise is optional — UI typically just fires-and-forgets.
   */
  setModelConfig: (config: Partial<AIModelConfig>) => Promise<void>;
  setConnectionStatus: (status: ModelConnectionStatus) => void;

  // Actions — Agent
  setAgentStatus: (agentName: string, status: Partial<AIAgentStatus>) => void;
  clearAgentStatus: (agentName: string) => void;

  // Actions — Chat
  appendMessage: (msg: ChatMessage) => void;
  appendDelta: (messageId: string, text: string) => void;
  clearMessages: () => void;
  sendMessage: (text: string, capabilityId?: string) => Promise<void>;
  /** Phase 6: Set the active session ID (used when switching sessions) */
  setActiveSessionId: (sessionId: string | null) => void;
}

// ─── Default Config ──────────────────────────────────────────────────

const DEFAULT_MODEL_CONFIG: AIModelConfig = {
  providerID: 'ollama',
  modelID: 'qwen3:8b',
  baseURL: 'http://localhost:11434',
};

// ─── Store ───────────────────────────────────────────────────────────
//
// IMPORTANT: aiStore no longer owns the agent runtime. Bootstrap creates
// the runtime in `main.tsx`; this store just persists user preferences
// and asks the platform to reload itself when the user changes them.

export const useAIStore = create<AIStoreState>()(
  persist(
    (set, get) => ({
      modelConfig: DEFAULT_MODEL_CONFIG,
      connectionStatus: 'disconnected',
      agents: {},

      // Chat initial state
      messages: [],
      isTyping: false,
      activeSessionId: null,

      setModelConfig: async (partial) => {
        const merged: AIModelConfig = { ...get().modelConfig, ...partial };
        set({ modelConfig: merged, connectionStatus: 'connecting' });

        // If bootstrap hasn't run yet (e.g. very early app start), the
        // platform API is not available. We still update the persisted config
        // so the next bootstrap picks it up; just skip reload.
        const platform = getPlatformAPI();
        if (!platform) {
          // eslint-disable-next-line no-console
          console.warn('[aiStore] setModelConfig: platform not ready yet, skipping reload');
          set({ connectionStatus: 'disconnected' });
          return;
        }

        try {
          await platform.reload(loadRuntimeConfig(merged));
          set({ connectionStatus: 'connected' });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[aiStore] runtime reload failed:', err);
          set({ connectionStatus: 'disconnected' });
          throw err;
        }
      },

      setConnectionStatus: (status) =>
        set({ connectionStatus: status }),

      setAgentStatus: (agentName, status) =>
        set((state) => ({
          agents: {
            ...state.agents,
            [agentName]: {
              ...state.agents[agentName],
              status: status.status ?? state.agents[agentName]?.status ?? 'idle',
              ...status,
            },
          },
        })),

      clearAgentStatus: (agentName) =>
        set((state) => {
          const { [agentName]: _, ...rest } = state.agents;
          return { agents: rest };
        }),

      // ── Chat actions ──────────────────────────────────────────────

      appendMessage: (msg) =>
        set((state) => ({ messages: [...state.messages, msg] })),

      appendDelta: (messageId, text) =>
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === messageId ? { ...m, content: m.content + text } : m,
          ),
        })),

      clearMessages: () => set({ messages: [], isTyping: false }),

      /** Phase 6: Set active session ID */
      setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),

      sendMessage: async (text, capabilityId) => {
        // Capability contract: refuse to fire a request when no
        // capability is active. UI should disable the send button to
        // surface this earlier; the guard here exists so that direct
        // dev-tool calls (`aiStore.sendMessage(text)`) don't pollute
        // the message list with a half-rendered assistant bubble.
        if (!capabilityId) {
          // eslint-disable-next-line no-console
          console.warn(
            '[aiStore] sendMessage called without an active capability — ignored. ' +
              'Activate a capability before sending or pass `capabilityId` explicitly.',
          );
          return;
        }

        // ── Session Management ─────────────────────────────────────
        // Auto-create session if none exists
        let sessionId = useSessionStore.getState().activeSessionId;
        let isFirstMessage = false;
        
        if (!sessionId) {
          const session = await useSessionStore.getState().createSession(capabilityId);
          sessionId = session.id;
          isFirstMessage = true;
          
          // Update aiStore's activeSessionId for compatibility
          set({ activeSessionId: sessionId });
        }

        const userMsgId = `msg-user-${Date.now()}`;
        const assistantMsgId = `msg-asst-${Date.now() + 1}`;

        // 1. Append user message to UI
        get().appendMessage({
          id: userMsgId,
          role: 'user',
          type: 'text',
          content: text,
          timestamp: Date.now(),
        });

        // 2. Persist user message to DB
        try {
          await useMessageStore.getState().addMessage(sessionId, {
            role: 'user',
            content: text,
          });
        } catch (err) {
          console.error('[aiStore] Failed to save user message to DB:', err);
          // Non-blocking: UI already shows the message
        }

        // 3. Set typing + create empty assistant message in UI
        set({ activeSessionId: sessionId });
        get().appendMessage({
          id: assistantMsgId,
          role: 'assistant',
          type: 'text',
          content: '',
          timestamp: Date.now(),
        });

        const removeEmptyAssistant = () => {
          set((state) => ({
            messages: state.messages.filter(
              (m) => !(m.id === assistantMsgId && m.content === ''),
            ),
          }));
        };

        const appendErrorMessage = (err: Error) => {
          // Map known error types to readable Chinese messages so the
          // UI doesn't dump `CapabilityDisabledError: ...` at the user.
          let content: string;
          if (err instanceof CapabilityDisabledError) {
            content = `能力『${err.displayName}』已被禁用，请在能力面板重新启用后重试`;
          } else if (err instanceof CapabilityNotFoundError) {
            content = `未找到能力 \"${err.capabilityId}\"，请选择一个已安装的能力`;
          } else if (err instanceof SessionAgentMismatchError) {
            content = `会话未绑定 Agent（${err.sessionID}），请刷新页面后重试`;
          } else {
            content = err.message || String(err);
          }
          get().appendMessage({
            id: `msg-err-${Date.now()}`,
            role: 'assistant',
            type: 'error',
            content,
            timestamp: Date.now(),
          });
        };

        // 4. Stream from agentService, with a guaranteed-terminal-state
        //    helper around the body — isTyping is reset in the helper's
        //    finally block, so we never leak "…" if `finish` never fires.
        let assistantContent = '';
        
        await withStreaming(
          {
            setFlag: (v) => set({ isTyping: v }),
            onError: (err) => {
              removeEmptyAssistant();
              appendErrorMessage(err);
            },
          },
          async () => {
            const { chatWithStream } = await import('@/services/agentService');
            const { useWorkspaceStore } = await import('@/stores/workspaceStore');
            // Ensure workspace exists before streaming so workspacePath is always absolute.
            // If no workspace is active yet, create one for this capability first.
            let workspacePath = useWorkspaceStore.getState().currentWorkspacePath ?? undefined;
            if (!workspacePath) {
              const wsInfo = await useWorkspaceStore.getState().createWorkspace(capabilityId);
              workspacePath = wsInfo.path;
            }
            await chatWithStream(
              { sessionID: sessionId, message: text, capabilityId, workspacePath },
              (event) => {
                if (event.type === 'text-delta') {
                  const delta = event.text ?? '';
                  assistantContent += delta;
                  get().appendDelta(assistantMsgId, delta);
                } else if (event.type === 'tool-call') {
                  get().appendMessage({
                    id: `msg-tool-${Date.now()}-${Math.random()}`,
                    role: 'assistant',
                    type: 'tool-call',
                    content: '',
                    timestamp: Date.now(),
                    toolName: event.toolName,
                    toolArgs: event.toolArgs,
                    toolStatus: 'pending',
                  });
                } else if (event.type === 'tool-result') {
                  // Update the last pending tool-call message
                  set((state) => {
                    const idx = [...state.messages]
                      .reverse()
                      .findIndex(
                        (m) => m.type === 'tool-call' && m.toolStatus === 'pending',
                      );
                    if (idx === -1) return {};
                    const realIdx = state.messages.length - 1 - idx;
                    const updated = state.messages.map((m, i) =>
                      i === realIdx
                        ? {
                            ...m,
                            toolResult: event.toolResult,
                            toolStatus: event.error ? ('error' as const) : ('done' as const),
                          }
                        : m,
                    );
                    return { messages: updated };
                  });
                } else if (event.type === 'error') {
                  // Surface the streamed error through the same error
                  // pipeline as a thrown rejection — we re-throw so the
                  // withStreaming helper's catch handles it (and the
                  // finally still resets isTyping).
                  removeEmptyAssistant();
                  get().appendMessage({
                    id: `msg-err-${Date.now()}`,
                    role: 'assistant',
                    type: 'error',
                    content: event.error ?? 'Unknown error',
                    timestamp: Date.now(),
                  });
                }
                // 'finish' is intentionally NOT handled here — the
                // withStreaming helper resets isTyping in its finally.
              },
            );
          },
        );

        // 5. Persist assistant message to DB after streaming completes
        try {
          if (assistantContent) {
            await useMessageStore.getState().addMessage(sessionId, {
              role: 'assistant',
              content: assistantContent,
            });
          }
        } catch (err) {
          console.error('[aiStore] Failed to save assistant message to DB:', err);
        }

        // 6. Update session's last_message_at
        try {
          await useSessionStore.getState().refreshSessionList();
        } catch (err) {
          console.error('[aiStore] Failed to refresh session list:', err);
        }

        // 7. Generate title after first message
        if (isFirstMessage) {
          // Fire and forget — don't block UI
          useSessionStore.getState()
            .generateTitle(sessionId, text)
            .catch((err) => {
              console.error('[aiStore] Failed to generate title:', err);
            });
        }
      },
    }),
    {
      name: 'seven-hrops-ai',
      version: 2,
      // ── Persist migration ────────────────────────────────────────
      //
      // Phase 12.0 of `runtime-multimodel-protocol-adapter` aligned the
      // frontend `ModelProvider` union to the canonical
      // `BUILT_IN_PROVIDER_IDS` from `agent-runtime/provider/plugins`,
      // dropping legacy aliases that the UI used to ship with:
      //
      //   claude        → anthropic
      //   qwen          → alibaba
      //   gemini        → google
      //   azure-openai  → openai   (azure was never wired through registry)
      //   azure         → openai
      //
      // Without migration, users with a previously persisted modelConfig
      // would boot into a `providerID` that the new registry rejects with
      // `UnknownProviderProtocolError`. We rewrite their stored ids on
      // first load after upgrade so the runtime can resolve them.
      migrate: (persistedState, version) => {
        const state = persistedState as { modelConfig?: { providerID?: string } } | undefined;
        if (!state?.modelConfig?.providerID) return state as never;
        if (version >= 2) return state as never;

        const LEGACY_PROVIDER_RENAME: Record<string, string> = {
          claude: 'anthropic',
          qwen: 'alibaba',
          gemini: 'google',
          'azure-openai': 'openai',
          azure: 'openai',
        };
        const legacyID = state.modelConfig.providerID;
        const canonicalID = LEGACY_PROVIDER_RENAME[legacyID];
        if (canonicalID) {
          // eslint-disable-next-line no-console
          console.info(
            `[aiStore] migrating persisted providerID "${legacyID}" → "${canonicalID}" ` +
              `(runtime-multimodel-protocol-adapter v2 schema).`,
          );
          state.modelConfig.providerID = canonicalID;
        }
        return state as never;
      },
      partialize: (state) => ({
        modelConfig: state.modelConfig,
      }),
    }
  )
);
