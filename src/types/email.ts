// ── Email Account Types ───────────────────────────────────────────────────────

export type AccountType = 'gmail' | 'outlook' | 'imap';

export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'reauth_required';

export interface EmailAccount {
  id: string;
  email: string;
  displayName?: string;
  accountType: AccountType;
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  status: ConnectionStatus;
}

// ── Email Message Types ───────────────────────────────────────────────────────

export interface EmailMessage {
  id: string;
  accountId: string;
  uid: number;
  messageId?: string;
  inReplyTo?: string;
  fromName?: string;
  fromEmail: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  bodyHtml?: string;
  bodyText?: string;
  isRead: boolean;
  date: string;
  threadId?: string;
}

export interface EmailThread {
  id: string;
  messages: EmailMessage[];
  subject: string;
  participants: string[];
  lastDate: string;
  isRead: boolean;
}

// ── Draft Types ───────────────────────────────────────────────────────────────

export interface EmailDraft {
  id: string;
  accountId: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyHtml: string;
  inReplyTo?: string;
  updatedAt: string;
}

// ── Send Queue Types ──────────────────────────────────────────────────────────

export type SendQueueStatus = 'pending' | 'sending' | 'sent' | 'failed';

export interface SendQueueItem {
  id: string;
  accountId: string;
  payload: SendEmailPayload;
  status: SendQueueStatus;
  error?: string;
  createdAt: string;
}

// ── Payload Types ─────────────────────────────────────────────────────────────

export interface SendEmailPayload {
  to: string[];
  cc: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  inReplyTo?: string;
}

export interface ImapSmtpConfig {
  email: string;
  displayName?: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
  testOnly: boolean;
}

// ── Composer Types ────────────────────────────────────────────────────────────

export type ComposerMode = 'new' | 'reply';

export interface ComposerInitialData {
  mode: ComposerMode;
  to?: string[];
  subject?: string;
  inReplyTo?: string;
  quotedBody?: string;
  draftId?: string;
}
