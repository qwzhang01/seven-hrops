/**
 * Email Store Unit Tests — Task 9.3
 * Covers: inbox cache TTL logic, send queue state transitions, draft persistence.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ── Mock @tauri-apps/api/core ─────────────────────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// ── Mock @/services/emailService ─────────────────────────────────────────────
// emailStore now calls emailService instead of invoke directly.
// We mock emailService here so tests can control its behavior.
const mockEmailServiceSendEmail = vi.fn();
const mockEmailServiceFetchInbox = vi.fn();
const mockEmailServiceSaveDraft = vi.fn();
const mockEmailServiceListAccounts = vi.fn();
const mockEmailServiceSaveAccount = vi.fn();
const mockEmailServiceDeleteAccount = vi.fn();

vi.mock('@/services/emailService', () => ({
  sendEmail: (...args: unknown[]) => mockEmailServiceSendEmail(...args),
  fetchInbox: (...args: unknown[]) => mockEmailServiceFetchInbox(...args),
  saveDraft: (...args: unknown[]) => mockEmailServiceSaveDraft(...args),
  listAccounts: (...args: unknown[]) => mockEmailServiceListAccounts(...args),
  saveAccount: (...args: unknown[]) => mockEmailServiceSaveAccount(...args),
  deleteAccount: (...args: unknown[]) => mockEmailServiceDeleteAccount(...args),
  startOAuth: vi.fn(),
}));

// ── Mock uuid ─────────────────────────────────────────────────────────────────
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).slice(2, 8)),
}));

// ─── emailStore — Inbox Cache TTL ─────────────────────────────────────────────
describe('emailStore — inbox cache TTL', () => {
  let useEmailStore: typeof import('@/stores/emailStore').useEmailStore;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mockEmailServiceFetchInbox.mockReset();

    const mod = await import('@/stores/emailStore');
    useEmailStore = mod.useEmailStore;

    // Reset store state
    useEmailStore.setState({
      accounts: [{ id: 'acc-1', email: 'test@example.com', accountType: 'imap', status: 'connected' }],
      activeAccountId: 'acc-1',
      inbox: [],
      inboxLoading: false,
      inboxCachedAt: null,
      drafts: [],
      sendQueue: [],
      composerOpen: false,
      composerInitialData: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should fetch inbox when cache is empty', async () => {
    mockEmailServiceFetchInbox.mockResolvedValueOnce([{ id: 'msg-1', subject: '测试邮件' }]);

    await useEmailStore.getState().fetchInbox();

    expect(mockEmailServiceFetchInbox).toHaveBeenCalledWith('acc-1', 50);
    expect(useEmailStore.getState().inbox).toHaveLength(1);
    expect(useEmailStore.getState().inboxCachedAt).not.toBeNull();
  });

  it('should skip fetch when cache is still valid (within 5 minutes)', async () => {
    // Set cache as fresh (just now)
    useEmailStore.setState({ inboxCachedAt: Date.now(), inbox: [{ id: 'msg-1' } as never] });

    await useEmailStore.getState().fetchInbox();

    expect(mockEmailServiceFetchInbox).not.toHaveBeenCalled();
    expect(useEmailStore.getState().inbox).toHaveLength(1);
  });

  it('should re-fetch when cache is expired (> 5 minutes)', async () => {
    // Set cache as stale (6 minutes ago)
    const staleTime = Date.now() - 6 * 60 * 1000;
    useEmailStore.setState({ inboxCachedAt: staleTime, inbox: [] });
    mockEmailServiceFetchInbox.mockResolvedValueOnce([{ id: 'msg-2', subject: '新邮件' }]);

    await useEmailStore.getState().fetchInbox();

    expect(mockEmailServiceFetchInbox).toHaveBeenCalledWith('acc-1', 50);
    expect(useEmailStore.getState().inbox).toHaveLength(1);
  });

  it('should force re-fetch regardless of cache when forceRefresh=true', async () => {
    // Set cache as fresh
    useEmailStore.setState({ inboxCachedAt: Date.now(), inbox: [{ id: 'old' } as never] });
    mockEmailServiceFetchInbox.mockResolvedValueOnce([{ id: 'new-msg' }]);

    await useEmailStore.getState().fetchInbox(true);

    expect(mockEmailServiceFetchInbox).toHaveBeenCalledWith('acc-1', 50);
  });

  it('should not fetch when no active account', async () => {
    useEmailStore.setState({ activeAccountId: null });

    await useEmailStore.getState().fetchInbox();

    expect(mockEmailServiceFetchInbox).not.toHaveBeenCalled();
  });

  it('should not fetch when already loading', async () => {
    useEmailStore.setState({ inboxLoading: true });

    await useEmailStore.getState().fetchInbox(true);

    expect(mockEmailServiceFetchInbox).not.toHaveBeenCalled();
  });

  it('should set inboxLoading to false on error', async () => {
    mockEmailServiceFetchInbox.mockRejectedValueOnce(new Error('IMAP connection failed'));

    await useEmailStore.getState().fetchInbox(true);

    expect(useEmailStore.getState().inboxLoading).toBe(false);
  });
});

// ─── emailStore — Send Queue State Transitions ────────────────────────────────
describe('emailStore — send queue state transitions', () => {
  let useEmailStore: typeof import('@/stores/emailStore').useEmailStore;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mockEmailServiceSendEmail.mockReset();

    const mod = await import('@/stores/emailStore');
    useEmailStore = mod.useEmailStore;

    useEmailStore.setState({
      accounts: [{ id: 'acc-1', email: 'test@example.com', accountType: 'imap', status: 'connected' }],
      activeAccountId: 'acc-1',
      inbox: [],
      inboxLoading: false,
      inboxCachedAt: null,
      drafts: [],
      sendQueue: [],
      composerOpen: false,
      composerInitialData: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should enqueue email with pending status', () => {
    mockEmailServiceSendEmail.mockResolvedValueOnce(undefined);

    const payload = { to: ['hr@company.com'], subject: '面试邀请', body: '您好...' };
    const queueId = useEmailStore.getState().enqueueEmail('acc-1', payload);

    const queue = useEmailStore.getState().sendQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe(queueId);
    expect(queue[0].status).toBe('pending');
    expect(queue[0].accountId).toBe('acc-1');
  });

  it('should transition to sent status on success', async () => {
    mockEmailServiceSendEmail.mockResolvedValueOnce(undefined);

    const queueId = useEmailStore.getState().enqueueEmail('acc-1', {
      to: ['a@b.com'],
      subject: '测试',
      body: '内容',
    });

    // Flush microtask queue: sendEmail → .then(markSent)
    await Promise.resolve();
    await Promise.resolve();

    const item = useEmailStore.getState().sendQueue.find((i) => i.id === queueId);
    expect(item?.status).toBe('sent');
  });

  it('should transition to failed status on error', async () => {
    mockEmailServiceSendEmail.mockRejectedValueOnce(new Error('SMTP auth failed'));

    const queueId = useEmailStore.getState().enqueueEmail('acc-1', {
      to: ['a@b.com'],
      subject: '测试',
      body: '内容',
    });

    await vi.runAllTimersAsync();

    const item = useEmailStore.getState().sendQueue.find((i) => i.id === queueId);
    expect(item?.status).toBe('failed');
    expect(item?.error).toContain('SMTP auth failed');
  });

  it('should remove sent item from queue after 3 seconds', async () => {
    mockEmailServiceSendEmail.mockResolvedValueOnce(undefined);

    const queueId = useEmailStore.getState().enqueueEmail('acc-1', {
      to: ['a@b.com'],
      subject: '测试',
      body: '内容',
    });

    await vi.runAllTimersAsync();

    // After markSent, a 3s timeout removes the item
    vi.advanceTimersByTime(3000);

    const item = useEmailStore.getState().sendQueue.find((i) => i.id === queueId);
    expect(item).toBeUndefined();
  });

  it('should markFailed with error message', () => {
    useEmailStore.setState({
      sendQueue: [
        { id: 'q-1', accountId: 'acc-1', payload: { to: [], subject: '', body: '' }, status: 'pending', createdAt: '' },
      ],
    });

    useEmailStore.getState().markFailed('q-1', 'Connection timeout');

    const item = useEmailStore.getState().sendQueue.find((i) => i.id === 'q-1');
    expect(item?.status).toBe('failed');
    expect(item?.error).toBe('Connection timeout');
  });

  it('should support multiple items in queue independently', () => {
    mockEmailServiceSendEmail.mockResolvedValue(undefined);

    useEmailStore.getState().enqueueEmail('acc-1', { to: ['a@b.com'], subject: '邮件1', body: '' });
    useEmailStore.getState().enqueueEmail('acc-1', { to: ['c@d.com'], subject: '邮件2', body: '' });

    expect(useEmailStore.getState().sendQueue).toHaveLength(2);
  });
});

// ─── emailStore — Draft Persistence ──────────────────────────────────────────
describe('emailStore — draft persistence', () => {
  let useEmailStore: typeof import('@/stores/emailStore').useEmailStore;

  beforeEach(async () => {
    vi.resetModules();
    mockEmailServiceSaveDraft.mockReset();

    const mod = await import('@/stores/emailStore');
    useEmailStore = mod.useEmailStore;

    useEmailStore.setState({
      accounts: [],
      activeAccountId: null,
      inbox: [],
      inboxLoading: false,
      inboxCachedAt: null,
      drafts: [],
      sendQueue: [],
      composerOpen: false,
      composerInitialData: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should save a new draft to store and call emailService.saveDraft', async () => {
    mockEmailServiceSaveDraft.mockResolvedValueOnce(undefined);

    const draft = {
      id: 'draft-1',
      accountId: 'acc-1',
      to: ['hr@company.com'],
      subject: 'Offer Letter',
      body: '<p>Dear Candidate...</p>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await useEmailStore.getState().saveDraft(draft);

    expect(useEmailStore.getState().drafts).toHaveLength(1);
    expect(useEmailStore.getState().drafts[0].id).toBe('draft-1');
    expect(mockEmailServiceSaveDraft).toHaveBeenCalledWith(draft);
  });

  it('should update existing draft in place', async () => {
    mockEmailServiceSaveDraft.mockResolvedValue(undefined);

    const draft = {
      id: 'draft-1',
      accountId: 'acc-1',
      to: ['hr@company.com'],
      subject: '原始主题',
      body: '原始内容',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await useEmailStore.getState().saveDraft(draft);
    await useEmailStore.getState().updateDraft('draft-1', { subject: '更新后的主题' });

    const updated = useEmailStore.getState().drafts.find((d) => d.id === 'draft-1');
    expect(updated?.subject).toBe('更新后的主题');
    expect(useEmailStore.getState().drafts).toHaveLength(1); // No duplicate
  });

  it('should delete draft from store', async () => {
    mockEmailServiceSaveDraft.mockResolvedValue(undefined);

    const draft = {
      id: 'draft-to-delete',
      accountId: 'acc-1',
      to: [],
      subject: '待删除草稿',
      body: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await useEmailStore.getState().saveDraft(draft);
    expect(useEmailStore.getState().drafts).toHaveLength(1);

    useEmailStore.getState().deleteDraft('draft-to-delete');
    expect(useEmailStore.getState().drafts).toHaveLength(0);
  });

  it('should not duplicate draft when saving same id twice', async () => {
    mockEmailServiceSaveDraft.mockResolvedValue(undefined);

    const draft = {
      id: 'draft-dup',
      accountId: 'acc-1',
      to: [],
      subject: '重复保存测试',
      body: 'v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await useEmailStore.getState().saveDraft(draft);
    await useEmailStore.getState().saveDraft({ ...draft, body: 'v2' });

    expect(useEmailStore.getState().drafts).toHaveLength(1);
    expect(useEmailStore.getState().drafts[0].body).toBe('v2');
  });

  it('should not throw when updateDraft is called with non-existent id', async () => {
    await expect(
      useEmailStore.getState().updateDraft('non-existent', { subject: '不存在' })
    ).resolves.not.toThrow();
  });

  it('should handle Tauri command failure gracefully without losing in-memory draft', async () => {
    mockEmailServiceSaveDraft.mockRejectedValueOnce(new Error('Disk full'));

    const draft = {
      id: 'draft-err',
      accountId: 'acc-1',
      to: [],
      subject: '磁盘满了',
      body: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Should not throw even if Tauri command fails
    await expect(useEmailStore.getState().saveDraft(draft)).resolves.not.toThrow();
    // In-memory state should still be updated
    expect(useEmailStore.getState().drafts).toHaveLength(1);
  });
});

// ─── emailStore — Composer State ─────────────────────────────────────────────
describe('emailStore — composer state', () => {
  let useEmailStore: typeof import('@/stores/emailStore').useEmailStore;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/stores/emailStore');
    useEmailStore = mod.useEmailStore;
    useEmailStore.setState({ composerOpen: false, composerInitialData: null });
  });

  it('should open composer with default new mode', () => {
    useEmailStore.getState().openComposer();
    expect(useEmailStore.getState().composerOpen).toBe(true);
    expect(useEmailStore.getState().composerInitialData?.mode).toBe('new');
  });

  it('should open composer with reply mode and pre-filled data', () => {
    useEmailStore.getState().openComposer({
      mode: 'reply',
      to: ['sender@example.com'],
      subject: 'Re: 面试邀请',
      inReplyTo: 'msg-123',
    });
    const data = useEmailStore.getState().composerInitialData;
    expect(data?.mode).toBe('reply');
    expect(data?.to).toContain('sender@example.com');
    expect(data?.subject).toBe('Re: 面试邀请');
  });

  it('should close composer and clear initial data', () => {
    useEmailStore.getState().openComposer({ mode: 'new' });
    useEmailStore.getState().closeComposer();
    expect(useEmailStore.getState().composerOpen).toBe(false);
    expect(useEmailStore.getState().composerInitialData).toBeNull();
  });
});

// ─── emailStore — Account Management ──────────────────────────────────────────
describe('emailStore — account management', () => {
  let useEmailStore: typeof import('@/stores/emailStore').useEmailStore;

  beforeEach(async () => {
    vi.resetModules();
    mockEmailServiceListAccounts.mockReset();
    mockEmailServiceDeleteAccount.mockReset();

    const mod = await import('@/stores/emailStore');
    useEmailStore = mod.useEmailStore;

    useEmailStore.setState({
      accounts: [],
      activeAccountId: null,
      inbox: [],
      inboxLoading: false,
      inboxCachedAt: null,
      drafts: [],
      sendQueue: [],
      composerOpen: false,
      composerInitialData: null,    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should load accounts and auto-select first one', async () => {
    const mockAccounts = [
      { id: 'acc-1', email: 'a@example.com', accountType: 'imap', status: 'connected' },
      { id: 'acc-2', email: 'b@example.com', accountType: 'gmail', status: 'connected' },
    ];
    mockEmailServiceListAccounts.mockResolvedValueOnce(mockAccounts);

    await useEmailStore.getState().loadAccounts();

    expect(useEmailStore.getState().accounts).toHaveLength(2);
    expect(useEmailStore.getState().activeAccountId).toBe('acc-1');
  });

  it('should not override existing activeAccountId when loading accounts', async () => {
    useEmailStore.setState({ activeAccountId: 'acc-2' });
    const mockAccounts = [
      { id: 'acc-1', email: 'a@example.com', accountType: 'imap', status: 'connected' },
      { id: 'acc-2', email: 'b@example.com', accountType: 'gmail', status: 'connected' },
    ];
    mockEmailServiceListAccounts.mockResolvedValueOnce(mockAccounts);

    await useEmailStore.getState().loadAccounts();

    expect(useEmailStore.getState().activeAccountId).toBe('acc-2');
  });

  it('should remove account and fallback to first remaining account', async () => {
    useEmailStore.setState({
      accounts: [
        { id: 'acc-1', email: 'a@example.com', accountType: 'imap', status: 'connected' },
        { id: 'acc-2', email: 'b@example.com', accountType: 'imap', status: 'connected' },
      ],
      activeAccountId: 'acc-1',
    });
    mockEmailServiceDeleteAccount.mockResolvedValueOnce(undefined);

    await useEmailStore.getState().removeAccount('acc-1');

    expect(useEmailStore.getState().accounts).toHaveLength(1);
    expect(useEmailStore.getState().activeAccountId).toBe('acc-2');
  });

  it('should clear inbox cache when switching accounts', () => {
    useEmailStore.setState({
      accounts: [
        { id: 'acc-1', email: 'a@example.com', accountType: 'imap', status: 'connected' },
        { id: 'acc-2', email: 'b@example.com', accountType: 'imap', status: 'connected' },
      ],
      activeAccountId: 'acc-1',
      inbox: [{ id: 'msg-1' } as never],
      inboxCachedAt: Date.now(),
    });

    // Mock fetchInbox to avoid actual call
    const fetchInboxSpy = vi.spyOn(useEmailStore.getState(), 'fetchInbox').mockResolvedValue();

    useEmailStore.getState().setActiveAccount('acc-2');

    expect(useEmailStore.getState().inbox).toHaveLength(0);
    expect(useEmailStore.getState().inboxCachedAt).toBeNull();
    expect(fetchInboxSpy).toHaveBeenCalledWith(true);
  });
});
