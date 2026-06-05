import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useShallow } from 'zustand/react/shallow';
import { useEmailStore } from '@/stores/emailStore';
import type { EmailAccount, ImapSmtpConfig, ConnectionStatus } from '@/types/email';

// ── Status Indicator ──────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ConnectionStatus }) {
  const colorMap: Record<ConnectionStatus, string> = {
    connected: 'bg-green-500',
    disconnected: 'bg-gray-400',
    error: 'bg-red-500',
    reauth_required: 'bg-yellow-500',
  };
  const labelMap: Record<ConnectionStatus, string> = {
    connected: '已连接',
    disconnected: '未连接',
    error: '连接错误',
    reauth_required: '需要重新授权',
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colorMap[status]}`}
      title={labelMap[status]}
    />
  );
}

// ── Account Type Icon ─────────────────────────────────────────────────────────

function AccountTypeIcon({ type }: { type: EmailAccount['accountType'] }) {
  const icons = { gmail: '📧', outlook: '📮', imap: '🗄️' };
  return <span className="text-base">{icons[type]}</span>;
}

// ── IMAP/SMTP Config Form ─────────────────────────────────────────────────────

function ImapConfigForm({
  onSave,
  onCancel,
}: {
  onSave: (config: ImapSmtpConfig) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ImapSmtpConfig>({
    email: '',
    displayName: '',
    imapHost: '',
    imapPort: 993,
    smtpHost: '',
    smtpPort: 587,
    username: '',
    password: '',
    testOnly: false,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (key: keyof ImapSmtpConfig, value: string | number | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await onSave({ ...form, testOnly: true });
      setTestResult({ ok: true, msg: '连接成功！' });
    } catch (err) {
      setTestResult({ ok: false, msg: String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...form, testOnly: false });
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-edge bg-slate-deep px-3 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-primary/50';

  return (
    <div className="space-y-3 p-4">
      <p className="text-xs font-medium text-text-secondary">手动配置 IMAP/SMTP</p>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className="mb-1 block text-[10px] text-text-tertiary">邮箱地址</label>
          <input
            className={inputCls}
            placeholder="you@example.com"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-[10px] text-text-tertiary">显示名称（可选）</label>
          <input
            className={inputCls}
            placeholder="张三"
            value={form.displayName ?? ''}
            onChange={(e) => update('displayName', e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-text-tertiary">IMAP 服务器</label>
          <input
            className={inputCls}
            placeholder="imap.example.com"
            value={form.imapHost}
            onChange={(e) => update('imapHost', e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-text-tertiary">IMAP 端口</label>
          <input
            className={inputCls}
            type="number"
            value={form.imapPort}
            onChange={(e) => update('imapPort', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-text-tertiary">SMTP 服务器</label>
          <input
            className={inputCls}
            placeholder="smtp.example.com"
            value={form.smtpHost}
            onChange={(e) => update('smtpHost', e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-text-tertiary">SMTP 端口</label>
          <input
            className={inputCls}
            type="number"
            value={form.smtpPort}
            onChange={(e) => update('smtpPort', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-text-tertiary">用户名</label>
          <input
            className={inputCls}
            placeholder="用户名或邮箱"
            value={form.username}
            onChange={(e) => update('username', e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] text-text-tertiary">密码 / 授权码</label>
          <input
            className={inputCls}
            type="password"
            placeholder="••••••••"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
          />
        </div>
      </div>

      {testResult && (
        <p
          className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}
        >
          {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleTest}
          disabled={testing}
          className="flex-1 rounded-lg border border-edge py-1.5 text-xs text-text-secondary transition-colors hover:bg-edge disabled:opacity-50"
        >
          {testing ? '测试中...' : '测试连接'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded-lg bg-primary py-1.5 text-xs text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存账户'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-edge px-3 py-1.5 text-xs text-text-tertiary transition-colors hover:bg-edge"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ── Delete Confirm Dialog ─────────────────────────────────────────────────────

function DeleteConfirmDialog({
  account,
  onConfirm,
  onCancel,
}: {
  account: EmailAccount;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-text-secondary">
        确认删除账户 <span className="font-medium text-text-primary">{account.email}</span>？
        <br />
        此操作将同时删除该账户的所有凭证，无法恢复。
      </p>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          className="flex-1 rounded-lg bg-red-500/80 py-1.5 text-xs text-white transition-colors hover:bg-red-500"
        >
          确认删除
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg border border-edge py-1.5 text-xs text-text-secondary transition-colors hover:bg-edge"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ── Main AccountManager ───────────────────────────────────────────────────────

export function AccountManager() {
  const {
    accounts,
    activeAccountId,
    addAccount,
    testAccountConfig,
    startOAuth,
    removeAccount,
    setActiveAccount,
  } =
    useEmailStore(
      useShallow((s) => ({
        accounts: s.accounts,
        activeAccountId: s.activeAccountId,
        addAccount: s.addAccount,
        testAccountConfig: s.testAccountConfig,
        startOAuth: s.startOAuth,
        removeAccount: s.removeAccount,
        setActiveAccount: s.setActiveAccount,
      }))
    );

  const [showImapForm, setShowImapForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EmailAccount | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthLoading, setOauthLoading] = useState<'gmail' | 'outlook' | null>(null);

  const handleAddImap = async (config: ImapSmtpConfig) => {
    if (config.testOnly) {
      // Just test — re-throw errors to show in form
      await testAccountConfig(config);
      return;
    }
    await addAccount(config);
    setShowImapForm(false);
  };

  const handleStartOAuth = async (provider: 'gmail' | 'outlook') => {
    setOauthError(null);
    setOauthLoading(provider);
    try {
      const clientId = import.meta.env.VITE_OAUTH_CLIENT_ID ?? '';
      const secretOrTenant = import.meta.env.VITE_OAUTH_SECRET_OR_TENANT ?? '';

      if (!clientId) {
        setOauthError('未配置 OAuth Client ID，请在 .env 中设置 VITE_OAUTH_CLIENT_ID');
        return;
      }

      const authUrl = await startOAuth(provider, clientId, secretOrTenant);

      // Open in system default browser via Tauri opener plugin
      await openUrl(authUrl as string);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AccountManager] OAuth start failed:', err);
      setOauthError(`OAuth 启动失败：${msg}`);
    } finally {
      setOauthLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await removeAccount(deleteTarget.id);
    setDeleteTarget(null);
  };

  if (deleteTarget) {
    return (
      <DeleteConfirmDialog
        account={deleteTarget}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    );
  }

  if (showImapForm) {
    return (
      <ImapConfigForm
        onSave={handleAddImap}
        onCancel={() => setShowImapForm(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
        邮件账户
      </p>

      {/* Account list */}
      {accounts.length === 0 ? (
        <p className="text-xs text-text-tertiary">暂无邮件账户，请添加</p>
      ) : (
        <div className="space-y-1">
          {accounts.map((account) => (
            <div
              key={account.id}
              onClick={() => setActiveAccount(account.id)}
              className={[
                'flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 transition-colors',
                account.id === activeAccountId
                  ? 'bg-primary/10 text-primary'
                  : 'text-text-secondary hover:bg-edge hover:text-text-primary',
              ].join(' ')}
            >
              <AccountTypeIcon type={account.accountType} />
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs font-medium">{account.email}</p>
                {account.displayName && (
                  <p className="truncate text-[10px] text-text-tertiary">{account.displayName}</p>
                )}
              </div>
              <StatusDot status={account.status} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(account);
                }}
                className="ml-1 rounded p-0.5 text-text-tertiary opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                title="删除账户"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9.5h5L11 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add account buttons */}
      <div className="mt-2 space-y-1.5">
        {oauthError && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[10px] text-red-400">
            {oauthError}
          </p>
        )}
        <button
          onClick={() => handleStartOAuth('gmail')}
          disabled={oauthLoading !== null}
          className="flex w-full items-center gap-2 rounded-lg border border-edge px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-edge hover:text-text-primary disabled:opacity-50"
        >
          <span>📧</span>
          <span>{oauthLoading === 'gmail' ? '正在跳转...' : '添加 Gmail 账户'}</span>
        </button>
        <button
          onClick={() => handleStartOAuth('outlook')}
          disabled={oauthLoading !== null}
          className="flex w-full items-center gap-2 rounded-lg border border-edge px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-edge hover:text-text-primary disabled:opacity-50"
        >
          <span>📮</span>
          <span>{oauthLoading === 'outlook' ? '正在跳转...' : '添加 Outlook 账户'}</span>
        </button>
        <button
          onClick={() => setShowImapForm(true)}
          className="flex w-full items-center gap-2 rounded-lg border border-edge px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-edge hover:text-text-primary"
        >
          <span>🗄️</span>
          <span>手动配置 IMAP/SMTP</span>
        </button>
      </div>
    </div>
  );
}
