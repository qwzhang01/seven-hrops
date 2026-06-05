/**
 * Email Service — L4 service layer for email Tauri commands.
 *
 * Design notes:
 *   - This is the ONLY place in the codebase that calls invoke() for email.
 *   - Stores and components must use this service instead of calling invoke directly.
 *   - OAuth flow (start_oauth) is handled separately in AccountManager via
 *     Tauri opener plugin — that is a UI-level action, not a data mutation.
 */

import { invoke } from "@tauri-apps/api/core"
import type { EmailAccount, EmailMessage, EmailDraft, ImapSmtpConfig, SendEmailPayload } from "@/types/email"

// ─── Account operations ──────────────────────────────────────────────

export async function listAccounts(): Promise<EmailAccount[]> {
  return invoke<EmailAccount[]>("list_accounts")
}

export async function saveAccount(config: ImapSmtpConfig): Promise<EmailAccount> {
  return invoke<EmailAccount>("save_account", { config })
}

export async function deleteAccount(accountId: string): Promise<void> {
  return invoke("delete_account", { accountId })
}

// ─── Inbox operations ────────────────────────────────────────────────

export async function fetchInbox(accountId: string, limit = 50): Promise<EmailMessage[]> {
  return invoke<EmailMessage[]>("fetch_inbox", { accountId, limit })
}

// ─── Draft operations ────────────────────────────────────────────────

export async function saveDraft(draft: EmailDraft): Promise<void> {
  return invoke("save_draft", { draft })
}

// ─── Send operations ─────────────────────────────────────────────────

export async function sendEmail(accountId: string, payload: SendEmailPayload): Promise<void> {
  return invoke("email_send", { accountId, payload })
}

// ─── OAuth operations ────────────────────────────────────────────────

export async function startOAuth(
  provider: "gmail" | "outlook",
  clientId: string,
  clientSecretOrTenant: string,
): Promise<string> {
  return invoke<string>("start_oauth", { provider, clientId, clientSecretOrTenant })
}
