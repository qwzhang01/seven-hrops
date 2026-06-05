import { useShallow } from 'zustand/react/shallow';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { useState, useCallback, useEffect } from 'react';
import type { FileTreeNode } from '@/types/workspace';

/**
 * ResourcePanel — right-side file tree panel.
 *
 * Reads file tree from workspaceStore (L5).
 * Does NOT import workspaceManager directly (L4 boundary).
 *
 * When currentWorkspaceId is null (session has no workspace),
 * shows an empty state instead of the file tree.
 *
 * Spec reference: openspec/changes/use_def/session-workspace-binding/design.md §D6
 */
export function ResourcePanel() {
  const { fileTree, currentWorkspaceId, refreshFileTree } = useWorkspaceStore(
    useShallow((s) => ({
      fileTree: s.fileTree,
      currentWorkspaceId: s.currentWorkspaceId,
      refreshFileTree: s.refreshFileTree,
    }))
  );

  const openContentViewer = useLayoutStore((s) => s.openContentViewer);

  // Track expanded directories: Set of directory paths
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // Auto-refresh file tree when currentWorkspaceId changes
  useEffect(() => {
    if (currentWorkspaceId) {
      refreshFileTree(currentWorkspaceId).catch((err) => {
        console.error('[ResourcePanel] auto refreshFileTree failed', err);
      });
    }
  }, [currentWorkspaceId, refreshFileTree]);

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
      openContentViewer({
        id: `output-${node.path}`,
        type: 'output',
        title: node.name,
        outputId: node.path,
      }, window.innerWidth);
    }
  };

  return (
    <div className="flex h-full flex-col bg-slate-deep">
      {/* ── Header ── */}
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
          {/* Refresh icon */}
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

      {/* ── File Tree / Empty State ── */}
      <div className="flex-1 overflow-y-auto scroll-soft px-1 py-1">
        {!currentWorkspaceId ? (
          /* No workspace for this session — Task 9.1/9.2 */
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-8 text-center">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-text-tertiary opacity-30">
              <path d="M6 8h20v18H6zM6 8l4-4h8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M13 18h6M16 15v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <p className="text-xs font-medium text-text-tertiary">当前会话无需工作空间</p>
            <p className="text-[11px] text-text-tertiary opacity-60">
              这是一个纯对话会话
            </p>
            {/* TODO(session-workspace-binding v2.1): trigger temporary workspace creation */}
            <button
              disabled
              className="mt-1 rounded-md border border-edge px-3 py-1.5 text-[11px] text-text-tertiary opacity-40 cursor-not-allowed"
              title="即将支持（v2.1）"
            >
              上传文件
            </button>
          </div>
        ) : fileTree.length === 0 ? (
          /* Has workspace but no files yet — Task 9.2 */
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-text-tertiary opacity-40">
              <path d="M6 8h20v18H6zM6 8l4-4h8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
            <p className="text-xs text-text-tertiary">暂无文件</p>
            <p className="text-[11px] text-text-tertiary opacity-60">
              拖入文件或等待 Agent 创建工作空间
            </p>
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
