import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEmailStore } from '@/stores/emailStore';
import { InboxView } from '@/components/email/InboxView';
import { Composer } from '@/components/email/Composer';
import { AccountManager } from '@/components/email/AccountManager';

/**
 * EmailView — email client view.
 * Integrates InboxView (real IMAP data), Composer, and AccountManager.
 */
export function EmailView() {
  const { accounts, composerOpen, fetchInbox } = useEmailStore(
    useShallow((s) => ({
      accounts: s.accounts,
      composerOpen: s.composerOpen,
      fetchInbox: s.fetchInbox,
    }))
  );

  // Fetch inbox on mount
  useEffect(() => {
    if (accounts.length > 0) {
      fetchInbox();
    }
  }, [accounts.length]);

  // No accounts configured — show account manager
  if (accounts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <span className="text-5xl">📭</span>
        <p className="text-sm font-medium text-text-primary">尚未配置邮件账户</p>
        <p className="text-xs text-text-tertiary">添加邮件账户后即可收发邮件</p>
        <div className="w-full max-w-sm">
          <AccountManager />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      <InboxView />
      {composerOpen && <Composer />}
    </div>
  );
}

