/**
 * messageStore 单元测试
 * 
 * 测试消息管理 store 的主要 action 和状态管理
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMessageStore } from '../messageStore';

// Mock the db service
vi.mock('@/services/db', () => ({
  messageCreate: vi.fn(),
  messageListBySession: vi.fn(),
  messageUpdateContent: vi.fn(),
  messageUpdateToolCalls: vi.fn(),
  messageGet: vi.fn(),
  messageDelete: vi.fn(),
}));

describe('messageStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useMessageStore.setState({
      messagesBySession: {},
      loading: false,
    });
    vi.clearAllMocks();
  });

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const state = useMessageStore.getState();
      
      expect(state.messagesBySession).toEqual({});
      expect(state.loading).toBe(false);
    });
  });

  describe('loadMessages', () => {
    it('应该成功加载会话消息', async () => {
      const { messageListBySession } = await import('@/services/db');
      const mockMessages = [
        {
          id: 'msg-1',
          session_id: 'session-1',
          role: 'user',
          content: 'Hello',
          content_parts: null,
          tool_calls: null,
          tokens_used: null,
          latency_ms: null,
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'msg-2',
          session_id: 'session-1',
          role: 'assistant',
          content: 'Hi there!',
          content_parts: null,
          tool_calls: null,
          tokens_used: 10,
          latency_ms: 500,
          created_at: '2024-01-01T00:00:01Z',
        },
      ];
      
      (messageListBySession as any).mockResolvedValue(mockMessages);

      const store = useMessageStore.getState();
      await store.loadMessages('session-1');

      expect(messageListBySession).toHaveBeenCalledWith('session-1');
      expect(useMessageStore.getState().messagesBySession['session-1']).toHaveLength(2);
      expect(useMessageStore.getState().messagesBySession['session-1'][0].content).toBe('Hello');
    });

    it('应该设置 loading 状态', async () => {
      const { messageListBySession } = await import('@/services/db');
      messageListBySession.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve([]), 100))
      );

      const store = useMessageStore.getState();
      const loadPromise = store.loadMessages('session-1');

      expect(useMessageStore.getState().loading).toBe(true);

      await loadPromise;

      expect(useMessageStore.getState().loading).toBe(false);
    });
  });

  describe('addMessage', () => {
    it('应该成功添加消息', async () => {
      const { messageCreate, messageGet } = await import('@/services/db');
      const mockMessageId = 'msg-123';
      (messageCreate as any).mockResolvedValue(mockMessageId);
      (messageGet as any).mockResolvedValue({
        id: mockMessageId,
        session_id: 'session-1',
        role: 'user',
        content: 'Test message',
        content_parts: null,
        tool_calls: null,
        tokens_used: null,
        latency_ms: null,
        created_at: new Date().toISOString(),
      });

      const store = useMessageStore.getState();
      const message = await store.addMessage('session-1', {
        role: 'user',
        content: 'Test message',
      });

      expect(message.id).toBe(mockMessageId);
      expect(messageCreate).toHaveBeenCalledWith({
        session_id: 'session-1',
        role: 'user',
        content: 'Test message',
      });
    });

    it('应该立即将消息添加到本地状态（乐观更新）', async () => {
      const { messageCreate, messageGet } = await import('@/services/db');
      const mockMessageId = 'msg-123';
      (messageCreate as any).mockResolvedValue(mockMessageId);
      (messageGet as any).mockResolvedValue({
        id: mockMessageId,
        session_id: 'session-1',
        role: 'user',
        content: 'Test message',
        content_parts: null,
        tool_calls: null,
        tokens_used: null,
        latency_ms: null,
        created_at: new Date().toISOString(),
      });

      const store = useMessageStore.getState();
      await store.addMessage('session-1', {
        role: 'user',
        content: 'Test message',
      });

      const messages = useMessageStore.getState().getMessagesForSession('session-1');
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('updateMessageContent', () => {
    it('应该成功更新消息内容', async () => {
      const { messageUpdateContent } = await import('@/services/db');
      (messageUpdateContent as any).mockResolvedValue(undefined);

      // 先添加一条消息到本地状态
      useMessageStore.setState({
        messagesBySession: {
          'session-1': [
            {
              id: 'msg-1',
              session_id: 'session-1',
              role: 'assistant',
              content: 'Old content',
              content_parts: null,
              tool_calls: null,
              tokens_used: null,
              latency_ms: null,
              created_at: '2024-01-01T00:00:00Z',
            },
          ],
        },
      });

      const store = useMessageStore.getState();
      await store.updateMessageContent('msg-1', 'New content');

      expect(messageUpdateContent).toHaveBeenCalledWith('msg-1', 'New content');
    });
  });

  describe('deleteMessage', () => {
    it('应该成功删除消息', async () => {
      const { messageDelete } = await import('@/services/db');
      (messageDelete as any).mockResolvedValue(undefined);

      // 先添加消息到本地状态
      useMessageStore.setState({
        messagesBySession: {
          'session-1': [
            {
              id: 'msg-1',
              session_id: 'session-1',
              role: 'user',
              content: 'To be deleted',
              content_parts: null,
              tool_calls: null,
              tokens_used: null,
              latency_ms: null,
              created_at: '2024-01-01T00:00:00Z',
            },
          ],
        },
      });

      const store = useMessageStore.getState();
      await store.deleteMessage('msg-1', 'session-1');

      expect(messageDelete).toHaveBeenCalledWith('msg-1');
      expect(useMessageStore.getState().getMessagesForSession('session-1')).toHaveLength(0);
    });
  });

  describe('clearMessages', () => {
    it('应该成功清空会话消息', () => {
      // 先添加消息到本地状态
      useMessageStore.setState({
        messagesBySession: {
          'session-1': [
            {
              id: 'msg-1',
              session_id: 'session-1',
              role: 'user',
              content: 'Message 1',
              content_parts: null,
              tool_calls: null,
              tokens_used: null,
              latency_ms: null,
              created_at: '2024-01-01T00:00:00Z',
            },
          ],
          'session-2': [
            {
              id: 'msg-2',
              session_id: 'session-2',
              role: 'user',
              content: 'Message 2',
              content_parts: null,
              tool_calls: null,
              tokens_used: null,
              latency_ms: null,
              created_at: '2024-01-01T00:00:00Z',
            },
          ],
        },
      });

      const store = useMessageStore.getState();
      store.clearMessages('session-1');

      expect(useMessageStore.getState().messagesBySession['session-1']).toBeUndefined();
      expect(useMessageStore.getState().messagesBySession['session-2']).toBeDefined();
    });
  });

  describe('getMessagesForSession', () => {
    it('应该返回指定会话的消息', () => {
      const mockMessages = [
        {
          id: 'msg-1',
          session_id: 'session-1',
          role: 'user',
          content: 'Message 1',
          content_parts: null,
          tool_calls: null,
          tokens_used: null,
          latency_ms: null,
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      useMessageStore.setState({
        messagesBySession: {
          'session-1': mockMessages,
        },
      });

      const store = useMessageStore.getState();
      const messages = store.getMessagesForSession('session-1');

      expect(messages).toEqual(mockMessages);
    });

    it('应该为不存在的会话返回空数组', () => {
      const store = useMessageStore.getState();
      const messages = store.getMessagesForSession('non-existent');

      expect(messages).toEqual([]);
    });
  });
});
