import { describe, it, expect, vi, beforeEach } from "vitest"
import type { EmailDraft, ImapSmtpConfig } from "@/types/email"

// Mock @tauri-apps/api/core before importing the service
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}))

import { invoke } from "@tauri-apps/api/core"
import {
  listAccounts,
  saveAccount,
  deleteAccount,
  fetchInbox,
  saveDraft,
  sendEmail,
} from "../emailService"

const mockInvoke = vi.mocked(invoke)

const makeConfig = (): ImapSmtpConfig => ({
  email: "test@example.com",
  displayName: "Test User",
  imapHost: "imap.example.com",
  imapPort: 993,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  username: "test@example.com",
  password: "secret",
  testOnly: false,
})

const makeDraft = (): EmailDraft => ({
  id: "draft-1",
  accountId: "acc-1",
  to: ["recipient@example.com"],
  cc: [],
  subject: "Test",
  bodyHtml: "<p>Hello</p>",
  updatedAt: new Date().toISOString(),
})

describe("emailService", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it("listAccounts calls invoke('list_accounts')", async () => {
    mockInvoke.mockResolvedValue([])
    await listAccounts()
    expect(mockInvoke).toHaveBeenCalledWith("list_accounts")
  })

  it("saveAccount calls invoke('save_account', { config })", async () => {
    const config = makeConfig()
    mockInvoke.mockResolvedValue({ id: "acc-1", email: config.email, accountType: "imap", status: "connected" })
    await saveAccount(config)
    expect(mockInvoke).toHaveBeenCalledWith("save_account", { config })
  })

  it("deleteAccount calls invoke('delete_account', { accountId })", async () => {
    mockInvoke.mockResolvedValue(undefined)
    await deleteAccount("acc-1")
    expect(mockInvoke).toHaveBeenCalledWith("delete_account", { accountId: "acc-1" })
  })

  it("fetchInbox calls invoke('fetch_inbox', { accountId, limit })", async () => {
    mockInvoke.mockResolvedValue([])
    await fetchInbox("acc-1", 30)
    expect(mockInvoke).toHaveBeenCalledWith("fetch_inbox", { accountId: "acc-1", limit: 30 })
  })

  it("fetchInbox uses default limit of 50", async () => {
    mockInvoke.mockResolvedValue([])
    await fetchInbox("acc-1")
    expect(mockInvoke).toHaveBeenCalledWith("fetch_inbox", { accountId: "acc-1", limit: 50 })
  })

  it("saveDraft calls invoke('save_draft', { draft })", async () => {
    const draft = makeDraft()
    mockInvoke.mockResolvedValue(undefined)
    await saveDraft(draft)
    expect(mockInvoke).toHaveBeenCalledWith("save_draft", { draft })
  })

  it("sendEmail calls invoke('email_send', { accountId, payload })", async () => {
    const payload = {
      to: ["r@example.com"],
      cc: [],
      subject: "Hi",
      bodyHtml: "<p>Hi</p>",
      bodyText: "Hi",
    }
    mockInvoke.mockResolvedValue(undefined)
    await sendEmail("acc-1", payload)
    expect(mockInvoke).toHaveBeenCalledWith("email_send", { accountId: "acc-1", payload })
  })
})
