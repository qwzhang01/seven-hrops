import { useEffect, useRef, useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLayoutStore } from '@/stores/layoutStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { tauriBrowser } from '@/lib/tauriBrowser';
import { BrowserView } from './BrowserView';
import { EmailView } from './EmailView';
import { OutputPreview } from './OutputPreview';
import type { FileTreeNode } from '@/types/workspace';

/**
 * ContentViewer — right-side content display area.
 * 内部结构：左侧文件树 + 右侧预览内容
 * Shows browser, email, or output preview based on active tab.
 * Manages native WebView visibility on tab switch and tab close.
 */
export function ContentViewer() {
  const {
    contentViewerTabs,
    activeContentTabId,
    isContentViewerHidden,
    closeContentTab,
    setActiveContentTab,
  } = useLayoutStore(
    useShallow((s) => ({
      contentViewerTabs: s.contentViewerTabs,
      activeContentTabId: s.activeContentTabId,
      isContentViewerHidden: s.isContentViewerHidden,
      closeContentTab: s.closeContentTab,
      setActiveContentTab: s.setActiveContentTab,
    }))
  );

  const { fileTree, currentWorkspaceId, refreshFileTree } = useWorkspaceStore(
    useShallow((s) => ({
      fileTree: s.fileTree,
      currentWorkspaceId: s.currentWorkspaceId,
      refreshFileTree: s.refreshFileTree,
    }))
  );

  // 文件树状态
  const [isFileTreeCollapsed, setIsFileTreeCollapsed] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const activeTab = contentViewerTabs.find((t) => t.id === activeContentTabId);
  const prevActiveTabTypeRef = useRef<string | undefined>(undefined);

  // ── Tab switch: sync native WebView visibility ────────────────────────────
  useEffect(() => {
    const currentType = activeTab?.type;
    const prevType = prevActiveTabTypeRef.current;

    if (currentType === prevType) return;

    if (currentType === 'browser') {
      tauriBrowser.show();
    } else if (prevType === 'browser') {
      tauriBrowser.hide();
    }

    prevActiveTabTypeRef.current = currentType;
  }, [activeTab?.type]);

  // ── Tab close: destroy WebView when browser tab is closed ─────────────────
  const handleCloseTab = (tabId: string) => {
    const tab = contentViewerTabs.find((t) => t.id === tabId);
    if (tab?.type === 'browser') {
      tauriBrowser.close();
    }
    closeContentTab(tabId);
  };

  // ── 文件树操作 ──────────────────────────────────────────────────────────
  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleRefresh = () => {
    if (currentWorkspaceId) {
      refreshFileTree(currentWorkspaceId);
    }
  };

  const handleFileClick = (node: FileTreeNode) => {
    if (node.type === 'file') {
      useLayoutStore.getState().openContentViewer({
        id: `output-${node.path}`,
        type: 'output',
        title: node.name,
        outputId: node.path,
      }, window.innerWidth);
    }
  };

  if (isContentViewerHidden) {
    return null;
  }

  return (
    <div className="flex h-full bg-slate-deep">
      {/* ── 左侧：文件树（可折叠） ── */}
      {!isFileTreeCollapsed && (
        <div className="flex h-full w-[200px] shrink-0 flex-col border-r border-edge">
          {/* 文件树头部 */}
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-edge px-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              文件
            </span>
            <button
              onClick={handleRefresh}
              disabled={!currentWorkspaceId}
              className="rounded p-1 text-text-tertiary transition-colors hover:bg-edge hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-40"
              title="刷新文件树"
              aria-label="刷新文件树"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M11 6.5A4.5 4.5 0 1 1 6.5 2a4.5 4.5 0 0 1 3.18 1.32M11 2v3H8"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          {/* 文件树内容 */}
          <div className="flex-1 overflow-y-auto scroll-soft px-1 py-1">
            {fileTree.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-text-tertiary opacity-40">
                  <path d="M6 8h20v18H6zM6 8l4-4h8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
                <p className="text-xs text-text-tertiary">暂无文件</p>
              </div>
            ) : (
              <FileTreeList
                nodes={fileTree}
                onFileClick={handleFileClick}
                depth={0}
                expandedDirs={expandedDirs}
                onToggleDir={toggleDir}
              />
            )}
          </div>
        </div>
      )}

      {/* ── 文件树折叠时显示的按钮 ── */}
      {isFileTreeCollapsed && (
        <button
          onClick={() => setIsFileTreeCollapsed(false)}
          className="flex h-10 w-6 shrink-0 items-center justify-center border-r border-edge text-text-tertiary transition-colors hover:bg-edge hover:text-text-secondary"
          title="展开文件树"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* ── 右侧：预览内容区 ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Tab Title Bar — only when tabs exist */}
        {contentViewerTabs.length > 0 && (
          <div className="relative z-10 flex h-10 shrink-0 items-center border-b border-edge bg-slate-deep">
            <div className="flex flex-1 items-center overflow-x-auto scroll-soft">
              {contentViewerTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={[
                    'group flex h-10 shrink-0 items-center gap-1.5 border-r border-edge px-3 text-xs transition-colors',
                    tab.id === activeContentTabId
                      ? 'bg-slate-raised text-text-primary'
                      : 'text-text-tertiary hover:bg-edge hover:text-text-secondary',
                  ].join(' ')}
                >
                  <button
                    onClick={() => setActiveContentTab(tab.id)}
                    className="flex items-center gap-1.5 focus:outline-none"
                  >
                    <span>{tab.title}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tab.id);
                    }}
                    className="ml-1 rounded p-0.5 opacity-50 transition-opacity hover:bg-edge hover:opacity-100"
                    aria-label={`关闭 ${tab.title}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          {contentViewerTabs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-text-tertiary">
              <div className="rounded-full border border-edge bg-slate-raised px-3 py-2 text-lg">
                ◻
              </div>
              <p className="text-sm font-medium text-text-secondary">暂无打开的内容</p>
              <p className="max-w-xs text-xs leading-5">
                从左侧打开浏览器或邮箱，或在文件面板中选择输出文件进行预览。
              </p>
            </div>
          ) : (
            <>
              {activeTab?.type === 'browser' && <BrowserView />}
              {activeTab?.type === 'email' && <EmailView />}
              {activeTab?.type === 'output' && (
                <OutputPreview outputId={activeTab.outputId} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-component: recursive file tree list ──────────────────────────

interface FileTreeListProps {
  nodes: FileTreeNode[];
  onFileClick: (node: FileTreeNode) => void;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
}

function FileTreeList({ nodes, onFileClick, depth, expandedDirs, onToggleDir }: FileTreeListProps) {
  return (
    <>
      {nodes.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          onFileClick={onFileClick}
          depth={depth}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
        />
      ))}
    </>
  );
}

interface FileTreeItemProps {
  node: FileTreeNode;
  onFileClick: (node: FileTreeNode) => void;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
}

function FileTreeItem({ node, onFileClick, depth, expandedDirs, onToggleDir }: FileTreeItemProps) {
  const isDir = node.type === 'directory';
  const isExpanded = isDir && expandedDirs.has(node.path);

  const handleClick = () => {
    if (isDir) {
      onToggleDir(node.path);
    } else {
      onFileClick(node);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className="flex w-full items-center gap-1 py-1 text-left text-xs text-text-secondary transition-colors hover:bg-edge hover:text-text-primary"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        title={node.path}
      >
        {/* Expand/collapse arrow for directories */}
        {isDir ? (
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              className={`shrink-0 text-text-tertiary transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            >
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span className="w-3 shrink-0" />
          )}

        {/* Folder / File icon */}
        {isDir ? (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 text-yellow-400/70">
            <path d="M1 3.5h11v7a1 1 0 01-1 1H2a1 1 0 01-1-1v-7zM1 3.5l2-2h3l1 1h4a1 1 0 011 1v0" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0 text-text-tertiary">
            <path d="M3 1h5l3 3v8a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {/* Recursive children (only when directory is expanded) */}
      {isDir && isExpanded && node.children && node.children.length > 0 && (
        <FileTreeList nodes={node.children} onFileClick={onFileClick} depth={depth + 1} expandedDirs={expandedDirs} onToggleDir={onToggleDir} />
      )}
    </div>
  );
}
