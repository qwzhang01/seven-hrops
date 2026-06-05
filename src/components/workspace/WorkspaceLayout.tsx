import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLayoutStore } from '@/stores/layoutStore';
import { LeftNavPanel } from '@/components/nav/LeftNavPanel';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { DropZone } from '@/components/chat/DropZone';
import { ContentViewer } from '@/components/viewer/ContentViewer';
import { PanelResizer } from '@/components/common/PanelResizer';
import { CapabilityHeader } from '@/components/capability/CapabilityHeader';

const MIN_PANEL_RATIO = 0.2;

interface WorkspaceLayoutProps {
  onOpenSettings?: () => void;
  onOpenLLMConfig?: () => void;
  onOpenWhitelist?: () => void;
}

/**
 * WorkspaceLayout — workspace container.
 *
 * Layout (L→R):
 *   [LeftNavPanel] | [PanelResizer] | [CapabilityHeader + ChatPanel] | [ResourcePanel] | [PanelResizer?] | [ContentViewer?]
 *
 * Left / content viewer widths and visibility are driven by layoutStore (persisted).
 * ResourcePanel is always visible so imported workspace files can be verified.
 * This component owns NO local state — it is a pure layout shell.
 */
export function WorkspaceLayout({ onOpenSettings, onOpenLLMConfig, onOpenWhitelist }: WorkspaceLayoutProps) {
  const {
    leftPanelWidth,
    contentViewerWidth,
    isLeftPanelCollapsed,
    isContentViewerHidden,
    setLeftPanelWidth,
    setContentViewerWidth,
    resetWidths,
  } = useLayoutStore(
    useShallow((s) => ({
      leftPanelWidth: s.leftPanelWidth,
      contentViewerWidth: s.contentViewerWidth,
      isLeftPanelCollapsed: s.isLeftPanelCollapsed,
      isContentViewerHidden: s.isContentViewerHidden,
      setLeftPanelWidth: s.setLeftPanelWidth,
      setContentViewerWidth: s.setContentViewerWidth,
      resetWidths: s.resetWidths,
    }))
  );

  const totalWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const minLeft = Math.floor(totalWidth * MIN_PANEL_RATIO);
  const minRight = Math.floor(totalWidth * MIN_PANEL_RATIO);

  // Collapsed left panel shows icon-only strip (~56px)
  const effectiveLeftWidth = isLeftPanelCollapsed ? 56 : leftPanelWidth;

  const handleLeftResize = useCallback(
    (delta: number) => {
      const current = useLayoutStore.getState().leftPanelWidth;
      const next = Math.max(minLeft, current + delta);
      setLeftPanelWidth(next);
    },
    [minLeft, setLeftPanelWidth]
  );

  const handleRightResize = useCallback(
    (delta: number) => {
      const current = useLayoutStore.getState().contentViewerWidth;
      const next = Math.max(minRight, current - delta);
      setContentViewerWidth(next);
    },
    [minRight, setContentViewerWidth]
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-slate-deep">
      {/* ── Left Nav Panel ── */}
      <div
        className="flex h-full shrink-0 flex-col"
        style={{ width: effectiveLeftWidth }}
      >
        <LeftNavPanel
          onOpenSettings={onOpenSettings}
          onOpenLLMConfig={onOpenLLMConfig}
          onOpenWhitelist={onOpenWhitelist}
        />
      </div>

      {/* ── Left Resizer ── */}
      {!isLeftPanelCollapsed && (
        <PanelResizer
          onResize={handleLeftResize}
          onDoubleClick={resetWidths}
          minLeft={minLeft}
          minRight={minRight}
          totalWidth={totalWidth}
          label="调整左侧面板宽度"
        />
      )}

      {/* ── Center: CapabilityHeader + ChatPanel (with DropZone) ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <CapabilityHeader />
        <div className="flex-1 overflow-hidden">
          <DropZone>
            <ChatPanel />
          </DropZone>
        </div>
      </div>

      {/* ── Right Resizer + ContentViewer (contains embedded file tree) ── */}
      {!isContentViewerHidden && (
        <>
          <PanelResizer
            onResize={handleRightResize}
            minLeft={minRight}
            minRight={minRight}
            totalWidth={totalWidth}
            label="调整右侧面板宽度"
          />
          <div
            className="flex h-full shrink-0 flex-col overflow-hidden"
            style={{ width: contentViewerWidth }}
          >
            <ContentViewer />
          </div>
        </>
      )}
    </div>
  );
}
