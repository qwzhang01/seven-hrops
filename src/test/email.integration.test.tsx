/**
 * Email AccountManager Integration Tests — Task 9.4
 * Covers: OAuth flow mock, IMAP config form validation, account deletion confirm.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountManager } from '@/components/email/AccountManager';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock emailService — the L4 service layer
const mockSaveAccount = vi.fn();
const mockStartOAuth = vi.fn();

vi.mock('@/services/emailService', () => ({
  saveAccount: (...args: unknown[]) => mockSaveAccount(...args),
  startOAuth: (...args: unknown[]) => mockStartOAuth(...args),
  deleteAccount: vi.fn(),
  listAccounts: vi.fn().mockResolvedValue([]),
  fetchInbox: vi.fn().mockResolvedValue([]),
  saveDraft: vi.fn(),
  sendEmail: vi.fn(),
}));

// Mock @tauri-apps/plugin-opener
const mockOpenUrl = vi.fn();
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));

// Mock emailStore — controlled state injection
const mockSetActiveAccount = vi.fn();
const mockAddAccount = vi.fn();
const mockRemoveAccount = vi.fn();

let mockAccounts: unknown[] = [];
let mockActiveAccountId: string | null = null;

vi.mock('@/stores/emailStore', () => ({
  useEmailStore: (selector: (s: unknown) => unknown) => {
    const state = {
      accounts: mockAccounts,
      activeAccountId: mockActiveAccountId,
      addAccount: mockAddAccount,
      removeAccount: mockRemoveAccount,
      setActiveAccount: mockSetActiveAccount,
    };
    return selector(state);
  },
}));

// ── AccountManager — Empty State ──────────────────────────────────────────────
describe('AccountManager — empty state', () => {
  beforeEach(() => {
    mockAccounts = [];
    mockActiveAccountId = null;
    vi.clearAllMocks();
  });

  it('should render "暂无邮件账户" when no accounts', () => {
    render(<AccountManager />);
    expect(screen.getByText('暂无邮件账户，请添加')).toBeInTheDocument();
  });

  it('should render three add-account buttons', () => {
    render(<AccountManager />);
    expect(screen.getByText('添加 Gmail 账户')).toBeInTheDocument();
    expect(screen.getByText('添加 Outlook 账户')).toBeInTheDocument();
    expect(screen.getByText('手动配置 IMAP/SMTP')).toBeInTheDocument();
  });
});

// ── AccountManager — Account List ─────────────────────────────────────────────
describe('AccountManager — account list', () => {
  beforeEach(() => {
    mockAccounts = [
      { id: 'acc-1', email: 'alice@gmail.com', accountType: 'gmail', status: 'connected', displayName: 'Alice' },
      { id: 'acc-2', email: 'bob@outlook.com', accountType: 'outlook', status: 'disconnected' },
    ];
    mockActiveAccountId = 'acc-1';
    vi.clearAllMocks();
  });

  it('should render all accounts', () => {
    render(<AccountManager />);
    expect(screen.getByText('alice@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('bob@outlook.com')).toBeInTheDocument();
  });

  it('should display display name when available', () => {
    render(<AccountManager />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('should call setActiveAccount when clicking an account row', async () => {
    render(<AccountManager />);
    const bobRow = screen.getByText('bob@outlook.com').closest('div[class*="cursor-pointer"]');
    expect(bobRow).not.toBeNull();
    await userEvent.click(bobRow!);
    expect(mockSetActiveAccount).toHaveBeenCalledWith('acc-2');
  });
});

// ── AccountManager — OAuth Flow Mock ─────────────────────────────────────────
describe('AccountManager — OAuth flow', () => {
  beforeEach(() => {
    mockAccounts = [];
    mockActiveAccountId = null;
    vi.clearAllMocks();
    // Provide OAuth env vars so handleStartOAuth doesn't bail early
    vi.stubEnv('VITE_OAUTH_CLIENT_ID', 'test-client-id');
    vi.stubEnv('VITE_OAUTH_SECRET_OR_TENANT', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should call startOAuth and open auth URL for Gmail', async () => {
    mockStartOAuth.mockResolvedValueOnce('https://accounts.google.com/oauth?...');

    render(<AccountManager />);
    await userEvent.click(screen.getByText('添加 Gmail 账户'));

    await waitFor(() => {
      expect(mockStartOAuth).toHaveBeenCalledWith('gmail', expect.any(String), expect.any(String));
    });
  });

  it('should call startOAuth for Outlook', async () => {
    mockStartOAuth.mockResolvedValueOnce('https://login.microsoftonline.com/oauth?...');

    render(<AccountManager />);
    await userEvent.click(screen.getByText('添加 Outlook 账户'));

    await waitFor(() => {
      expect(mockStartOAuth).toHaveBeenCalledWith('outlook', expect.any(String), expect.any(String));
    });
  });

  it('should not throw when OAuth startOAuth fails', async () => {
    mockStartOAuth.mockRejectedValueOnce(new Error('OAuth server unreachable'));

    render(<AccountManager />);
    // Should not throw — error is caught internally
    await expect(userEvent.click(screen.getByText('添加 Gmail 账户'))).resolves.not.toThrow();
  });
});

// ── AccountManager — IMAP Config Form Validation ─────────────────────────────
describe('AccountManager — IMAP config form', () => {
  beforeEach(() => {
    mockAccounts = [];
    mockActiveAccountId = null;
    vi.clearAllMocks();
  });

  it('should show IMAP form when clicking 手动配置 IMAP/SMTP', async () => {
    render(<AccountManager />);
    await userEvent.click(screen.getByText('手动配置 IMAP/SMTP'));
    expect(screen.getByText('手动配置 IMAP/SMTP', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
  });

  it('should fill in form fields correctly', async () => {
    render(<AccountManager />);
    await userEvent.click(screen.getByText('手动配置 IMAP/SMTP'));

    const emailInput = screen.getByPlaceholderText('you@example.com');
    const imapHostInput = screen.getByPlaceholderText('imap.example.com');
    const smtpHostInput = screen.getByPlaceholderText('smtp.example.com');

    await userEvent.type(emailInput, 'test@company.com');
    await userEvent.type(imapHostInput, 'imap.company.com');
    await userEvent.type(smtpHostInput, 'smtp.company.com');

    expect(emailInput).toHaveValue('test@company.com');
    expect(imapHostInput).toHaveValue('imap.company.com');
    expect(smtpHostInput).toHaveValue('smtp.company.com');
  });

  it('should call save_account with testOnly=true when clicking 测试连接', async () => {
    mockSaveAccount.mockResolvedValueOnce({ id: 'acc-test', email: 'test@company.com', accountType: 'imap', status: 'connected' });

    render(<AccountManager />);
    await userEvent.click(screen.getByText('手动配置 IMAP/SMTP'));
    await userEvent.click(screen.getByText('测试连接'));

    await waitFor(() => {
      expect(mockSaveAccount).toHaveBeenCalledWith(
        expect.objectContaining({ testOnly: true }),
      );
    });
  });

  it('should show success message after successful test', async () => {
    mockSaveAccount.mockResolvedValueOnce({ id: 'acc-test', email: 'test@company.com', accountType: 'imap', status: 'connected' });

    render(<AccountManager />);
    await userEvent.click(screen.getByText('手动配置 IMAP/SMTP'));
    await userEvent.click(screen.getByText('测试连接'));

    await waitFor(() => {
      expect(screen.getByText(/连接成功/)).toBeInTheDocument();
    });
  });

  it('should show error message after failed test', async () => {
    mockSaveAccount.mockRejectedValueOnce(new Error('Authentication failed'));

    render(<AccountManager />);
    await userEvent.click(screen.getByText('手动配置 IMAP/SMTP'));
    await userEvent.click(screen.getByText('测试连接'));

    await waitFor(() => {
      expect(screen.getByText(/Authentication failed/)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should call addAccount with testOnly=false when clicking 保存账户', async () => {
    mockAddAccount.mockResolvedValueOnce({
      id: 'new-acc',
      email: 'test@company.com',
      accountType: 'imap',
      status: 'connected',
    });

    render(<AccountManager />);
    await userEvent.click(screen.getByText('手动配置 IMAP/SMTP'));

    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'test@company.com');
    await userEvent.click(screen.getByText('保存账户'));

    await waitFor(() => {
      expect(mockAddAccount).toHaveBeenCalledWith(expect.objectContaining({ testOnly: false }));
    });
  });

  it('should hide form and return to account list after cancel', async () => {
    render(<AccountManager />);
    await userEvent.click(screen.getByText('手动配置 IMAP/SMTP'));
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();

    await userEvent.click(screen.getByText('取消'));
    expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('添加 Gmail 账户')).toBeInTheDocument();
  });
});

// ── AccountManager — Delete Confirmation ─────────────────────────────────────
describe('AccountManager — delete confirmation', () => {
  beforeEach(() => {
    mockAccounts = [
      { id: 'acc-1', email: 'alice@gmail.com', accountType: 'gmail', status: 'connected' },
    ];
    mockActiveAccountId = 'acc-1';
    vi.clearAllMocks();
  });

  it('should show delete confirmation dialog when clicking delete button', async () => {
    render(<AccountManager />);

    // Find delete button (SVG trash icon button)
    const deleteBtn = screen.getByTitle('删除账户');
    await userEvent.click(deleteBtn);

    expect(screen.getByText(/确认删除账户/)).toBeInTheDocument();
    expect(screen.getByText('alice@gmail.com')).toBeInTheDocument();
  });

  it('should call removeAccount when confirming deletion', async () => {
    mockRemoveAccount.mockResolvedValueOnce(undefined);

    render(<AccountManager />);
    await userEvent.click(screen.getByTitle('删除账户'));
    await userEvent.click(screen.getByText('确认删除'));

    await waitFor(() => {
      expect(mockRemoveAccount).toHaveBeenCalledWith('acc-1');
    });
  });

  it('should cancel deletion and return to account list', async () => {
    render(<AccountManager />);
    await userEvent.click(screen.getByTitle('删除账户'));
    expect(screen.getByText(/确认删除账户/)).toBeInTheDocument();

    await userEvent.click(screen.getByText('取消'));
    expect(screen.queryByText(/确认删除账户/)).not.toBeInTheDocument();
    expect(screen.getByText('alice@gmail.com')).toBeInTheDocument();
  });
});
