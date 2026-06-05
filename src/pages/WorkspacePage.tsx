import { useState } from 'react';
import { WorkspaceLayout } from '@/components/workspace/WorkspaceLayout';
import { StatusBar } from '@/components/workspace/StatusBar';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { LLMConfigModal } from '@/components/modals/LLMConfigModal';
import { SilentSwitchToast } from '@/components/chat/SilentSwitchToast';

/**
 * WorkspacePage — main page (L7).
 *
 * Responsibilities:
 *   - Assemble WorkspaceLayout (three-column shell)
 *   - Manage modal open/close state (local useState)
 *   - Render StatusBar at the bottom
 *
 * Does NOT call services or invoke directly.
 */
export function WorkspacePage() {
  const [showSettings, setShowSettings] = useState(false);
  const [showLLMConfig, setShowLLMConfig] = useState(false);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-deep text-text-primary">
      {/* ── Main three-column layout ── */}
      <div className="flex-1 overflow-hidden">
        <WorkspaceLayout
          onOpenSettings={() => setShowSettings(true)}
          onOpenLLMConfig={() => setShowLLMConfig(true)}
        />
      </div>

      {/* ── Bottom status bar ── */}
      <StatusBar />

      {/* ── Modals ── */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showLLMConfig && <LLMConfigModal onClose={() => setShowLLMConfig(false)} />}

      {/* ── Silent Switch Toast (Phase G) ── */}
      <SilentSwitchToast />
    </div>
  );
}
