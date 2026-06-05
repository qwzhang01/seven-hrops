import { create } from 'zustand';
import type { Message, MessageInput } from '@/services/db';
import {
  messageCreate,
  messageListBySession,
  messageUpdateContent,
  messageUpdateToolCalls,
  messageGet,
  messageDelete,
} from '@/services/db';

// ─── State Interface ──────────────────────────────────────────────

interface MessageState {
  // State: 按会话 ID 索引的消息字典
  messagesBySession: Record<string, Message[]>;
  loading: boolean;

  // Actions
  loadMessages: (sessionId: string) => Promise<void>;
  addMessage: (sessionId: string, input: Omit<MessageInput, 'session_id'>) => Promise<Message>;
  updateMessageContent: (messageId: string, content: string) => Promise<void>;
  updateMessageToolCalls: (messageId: string, toolCalls: string) => Promise<void>;
  deleteMessage: (messageId: string, sessionId: string) => Promise<void>;
  clearMessages: (sessionId: string) => void;
  getMessagesForSession: (sessionId: string) => Message[];
}

// ─── Store ───────────────────────────────────────────────────────

export const useMessageStore = create<MessageState>()((set, get) => ({
  // Initial state
  messagesBySession: {},
  loading: false,

  // ── Actions ────────────────────────────────────────────────────

  /**
   * 加载指定会话的所有消息
   */
  loadMessages: async (sessionId) => {
    set({ loading: true });
    try {
      const messages = await messageListBySession(sessionId);
      
      // 按创建时间排序（旧的在前）
      const sorted = messages.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      set((state) => ({
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: sorted,
        },
        loading: false,
      }));
    } catch (error) {
      console.error('[messageStore] loadMessages failed:', error);
      set({ loading: false });
      throw error;
    }
  },

  /**
   * 添加一条新消息到会话
   * @returns 创建的消息对象
   */
  addMessage: async (sessionId, input) => {
    const messageId = await messageCreate({
      session_id: sessionId,
      ...input,
    });

    const message = await messageGet(messageId);
    if (!message) {
      throw new Error(`Failed to create message: ${messageId}`);
    }

    // 添加到本地状态
    set((state) => {
      const sessionMessages = state.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: [...sessionMessages, message],
        },
      };
    });

    return message;
  },

  /**
   * 更新消息内容（用于流式更新）
   */
  updateMessageContent: async (messageId, content) => {
    await messageUpdateContent(messageId, content);

    // 更新本地状态
    set((state) => {
      const newMessagesBySession = { ...state.messagesBySession };
      for (const sessionId of Object.keys(newMessagesBySession)) {
        const messages = newMessagesBySession[sessionId];
        const idx = messages.findIndex((m) => m.id === messageId);
        if (idx !== -1) {
          newMessagesBySession[sessionId] = [
            ...messages.slice(0, idx),
            { ...messages[idx], content },
            ...messages.slice(idx + 1),
          ];
          break;
        }
      }
      return { messagesBySession: newMessagesBySession };
    });
  },

  /**
   * 更新消息的 tool_calls
   */
  updateMessageToolCalls: async (messageId, toolCalls) => {
    await messageUpdateToolCalls(messageId, toolCalls);
  },

  /**
   * 删除消息
   */
  deleteMessage: async (messageId, sessionId) => {
    await messageDelete(messageId);

    // 从本地状态移除
    set((state) => {
      const sessionMessages = state.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...state.messagesBySession,
          [sessionId]: sessionMessages.filter((m) => m.id !== messageId),
        },
      };
    });
  },

  /**
   * 清空指定会话的消息（本地状态）
   */
  clearMessages: (sessionId) => {
    set((state) => {
      const newMessagesBySession = { ...state.messagesBySession };
      delete newMessagesBySession[sessionId];
      return { messagesBySession: newMessagesBySession };
    });
  },

  /**
   * 获取指定会话的消息（selector 友好）
   */
  getMessagesForSession: (sessionId) => {
    return get().messagesBySession[sessionId] ?? [];
  },
}));

// ─── Selectors ─────────────────────────────────────────────────────

/**
 * 获取指定会话的消息列表
 */
export const useMessagesForSession = (sessionId: string) =>
  useMessageStore((state) => state.messagesBySession[sessionId] ?? []);

/**
 * 获取加载状态
 */
export const useMessageLoading = () =>
  useMessageStore((state) => state.loading);
