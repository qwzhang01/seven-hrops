import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import * as emailService from '@/services/emailService';
import type {
  EmailAccount,
  EmailMessage,
  EmailDraft,
  SendQueueItem,
  SendEmailPayload,
  ImapSmtpConfig,
} from '@/types/email';

// Cache TTL: 5 minutes
const INBOX_CACHE_TTL_MS = 5 * 60 * 1000;

interface EmailState {
  // Account management
  accounts: EmailAccount[];
  activeAccountId: string | null;

  // Inbox
  inbox: EmailMessage[];
  inboxLoading: boolean;
  inboxCachedAt: number | null;

  // Drafts
  drafts: EmailDraft[];

  // Send queue
  sendQueue: SendQueueItem[];

  // Composer state
  composerOpen: boolean;
  composerInitialData: {
    to?: string[];
    subject?: string;
    inReplyTo?: string;
    quotedBody?: string;
    draftId?: string;
    mode: 'new' | 'reply';
  } | null;
}

interface EmailActions {
  // Account actions
  loadAccounts: () => Promise<void>;
  setActiveAccount: (accountId: string) => void;
  addAccount: (config: ImapSmtpConfig) => Promise<EmailAccount>;
  testAccountConfig: (config: ImapSmtpConfig) => Promise<void>;
  startOAuth: (provider: 'gmail' | 'outlook', clientId: string, secretOrTenant: string) => Promise<string>;
  removeAccount: (accountId: string) => Promise<void>;

  // Inbox actions
  fetchInbox: (forceRefresh?: boolean) => Promise<void>;

  // Draft actions
  saveDraft: (draft: EmailDraft) => Promise<void>;
  updateDraft: (draftId: string, updates: Partial<EmailDraft>) => Promise<void>;
  deleteDraft: (draftId: string) => void;

  // Send queue actions
  enqueueEmail: (accountId: string, payload: SendEmailPayload) => string;
  markSent: (queueId: string) => void;
  markFailed: (queueId: string, error: string) => void;

  // Composer actions
  openComposer: (data?: EmailState['composerInitialData']) => void;
  closeComposer: () => void;
}

export const useEmailStore = create<EmailState & EmailActions>((set, get) => ({
  // ── Initial State ──────────────────────────────────────────────────────────
  accounts: [],
  activeAccountId: null,
  inbox: [],
  inboxLoading: false,
  inboxCachedAt: null,
  drafts: [],
  sendQueue: [],
  composerOpen: false,
  composerInitialData: null,

  // ── Account Actions ────────────────────────────────────────────────────────

  loadAccounts: async () => {
    try {
      const accounts = await emailService.listAccounts();
      set((state) => ({
        accounts,
        // Auto-select first account if none selected
        activeAccountId:
          state.activeAccountId ?? (accounts.length > 0 ? accounts[0].id : null),
      }));
    } catch (err) {
      console.error('[emailStore] Failed to load accounts:', err);
    }
  },

  setActiveAccount: (accountId) => {
    set({ activeAccountId: accountId, inbox: [], inboxCachedAt: null });
    // Trigger inbox refresh for new account
    get().fetchInbox(true);
  },

  addAccount: async (config) => {
    const account = await emailService.saveAccount(config);
    set((state) => ({
      accounts: [...state.accounts, account],
      activeAccountId: state.activeAccountId ?? account.id,
    }));
    return account;
  },

  testAccountConfig: async (config) => {
    await emailService.saveAccount({ ...config, testOnly: true });
  },

  startOAuth: async (provider, clientId, secretOrTenant) =>
    emailService.startOAuth(provider, clientId, secretOrTenant),

  removeAccount: async (accountId) => {
    await emailService.deleteAccount(accountId);
    set((state) => {
      const accounts = state.accounts.filter((a) => a.id !== accountId);
      const activeAccountId =
        state.activeAccountId === accountId
          ? (accounts[0]?.id ?? null)
          : state.activeAccountId;
      return { accounts, activeAccountId };
    });
  },

  // ── Inbox Actions ──────────────────────────────────────────────────────────

  fetchInbox: async (forceRefresh = false) => {
    const { activeAccountId, inboxCachedAt, inboxLoading } = get();
    if (!activeAccountId) return;
    if (inboxLoading) return;

    // Check cache TTL
    const now = Date.now();
    if (!forceRefresh && inboxCachedAt && now - inboxCachedAt < INBOX_CACHE_TTL_MS) {
      return; // Cache still valid
    }

    set({ inboxLoading: true });
    try {
      const messages = await emailService.fetchInbox(activeAccountId, 50);
      set({ inbox: messages, inboxCachedAt: Date.now(), inboxLoading: false });
    } catch (err) {
      console.error('[emailStore] Failed to fetch inbox:', err);
      set({ inboxLoading: false });
    }
  },

  // ── Draft Actions ──────────────────────────────────────────────────────────

  saveDraft: async (draft) => {
    set((state) => {
      const exists = state.drafts.find((d) => d.id === draft.id);
      const drafts = exists
        ? state.drafts.map((d) => (d.id === draft.id ? draft : d))
        : [...state.drafts, draft];
      return { drafts };
    });

    // Persist to disk via email service
    try {
      await emailService.saveDraft(draft);
    } catch (err) {
      console.error('[emailStore] Failed to persist draft:', err);
    }
  },

  updateDraft: async (draftId, updates) => {
    const { drafts, saveDraft } = get();
    const existing = drafts.find((d) => d.id === draftId);
    if (!existing) return;

    const updated: EmailDraft = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await saveDraft(updated);
  },

  deleteDraft: (draftId) => {
    set((state) => ({
      drafts: state.drafts.filter((d) => d.id !== draftId),
    }));
  },

  // ── Send Queue Actions ─────────────────────────────────────────────────────

  enqueueEmail: (accountId, payload) => {
    const queueId = uuidv4();
    const item: SendQueueItem = {
      id: queueId,
      accountId,
      payload,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    set((state) => ({ sendQueue: [...state.sendQueue, item] }));

    // Fire and forget — Rust backend sends via SMTP
    emailService.sendEmail(accountId, payload)
      .then(() => get().markSent(queueId))
      .catch((err: unknown) =>
        get().markFailed(queueId, String(err))
      );

    return queueId;
  },

  markSent: (queueId) => {
    set((state) => ({
      sendQueue: state.sendQueue.map((item) =>
        item.id === queueId ? { ...item, status: 'sent' as const } : item
      ),
    }));
    // Remove from queue after 3 seconds
    setTimeout(() => {
      set((state) => ({
        sendQueue: state.sendQueue.filter((item) => item.id !== queueId),
      }));
    }, 3000);
  },

  markFailed: (queueId, error) => {
    set((state) => ({
      sendQueue: state.sendQueue.map((item) =>
        item.id === queueId ? { ...item, status: 'failed' as const, error } : item
      ),
    }));
  },

  // ── Composer Actions ───────────────────────────────────────────────────────

  openComposer: (data = null) => {
    set({
      composerOpen: true,
      composerInitialData: data ?? { mode: 'new' },
    });
  },

  closeComposer: () => {
    set({ composerOpen: false, composerInitialData: null });
  },
}));
