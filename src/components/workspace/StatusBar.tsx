import { useShallow } from 'zustand/react/shallow';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAIStore } from '@/stores/aiStore';

/**
 * StatusBar — bottom status bar.
 *
 * READ-ONLY: displays workspace path + Agent running state.
 * No onClick handlers, no store action calls.
 */
export function StatusBar() {
  const { currentWorkspacePath } = useWorkspaceStore(
    useShallow((s) => ({ currentWorkspacePath: s.currentWorkspacePath }))
  );

  const isTyping = useAIStore((s) => s.isTyping);

  // Truncate long paths — show last 2 segments
  const displayPath = currentWorkspacePath
    ? truncatePath(currentWorkspacePath)
    : null;

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-edge bg-slate-deep px-3">
      {/* Left: workspace path */}
      <div className="flex items-center gap-1.5 min-w-0">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 text-text-tertiary">
          <path d="M1 2.5h9v7a.5.5 0 01-.5.5h-8A.5.5 0 011 9.5v-7zM1 2.5l2-2h3l1 1h2.5a.5.5 0 01.5.5v0" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
        </svg>
        {displayPath ? (
          <span className="truncate text-[11px] text-text-tertiary" title={currentWorkspacePath ?? ''}>
            {displayPath}
          </span>
        ) : (
          <span className="text-[11px] text-text-tertiary opacity-50">未选择工作空间</span>
        )}
      </div>

      {/* Right: Agent status */}
      <div className="flex shrink-0 items-center gap-1.5">
        {isTyping ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            <span className="text-[11px] text-primary">Agent 运行中</span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 rounded-full bg-green-500/60" />
            <span className="text-[11px] text-text-tertiary">就绪</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function truncatePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join('/')}`;
}
