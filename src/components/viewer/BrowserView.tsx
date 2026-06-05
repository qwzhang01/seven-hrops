import { useState, useRef, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLayoutStore } from '@/stores/layoutStore';
import { tauriBrowser } from '@/lib/tauriBrowser';

/**
 * BrowserView — native Tauri WebView browser.
 * The content area is a transparent placeholder div; the actual rendering is
 * done by a native WebView child created via Tauri IPC.
 * ResizeObserver keeps the native WebView in sync with the placeholder rect.
 */
export function BrowserView() {
  const [inputUrl, setInputUrl] = useState('');
  const [isAIControlled] = useState(false);
  const placeholderRef = useRef<HTMLDivElement>(null);
  // Track whether the native WebView has been created
  const webviewCreated = useRef(false);

  const { isContentViewerHidden } = useLayoutStore(
    useShallow((s) => ({ isContentViewerHidden: s.isContentViewerHidden }))
  );

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getRect = useCallback(() => {
    if (!placeholderRef.current) return null;
    const r = placeholderRef.current.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, []);

  // ── Mount / Unmount ───────────────────────────────────────────────────────

  useEffect(() => {
    const rect = getRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    tauriBrowser.open('about:blank', rect).then(() => {
      webviewCreated.current = true;
    });

    return () => {
      tauriBrowser.close();
      webviewCreated.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ResizeObserver: keep native WebView in sync ───────────────────────────

  useEffect(() => {
    const el = placeholderRef.current;
    if (!el) return;

    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = getRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          tauriBrowser.resize(rect);
        }
        rafId = null;
      });
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [getRect]);

  // ── Panel hide/show animation sync ───────────────────────────────────────

  useEffect(() => {
    if (isContentViewerHidden) {
      tauriBrowser.hide();
    } else {
      // Wait for the 250ms CSS transition to finish before repositioning
      const timer = setTimeout(() => {
        const rect = getRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          tauriBrowser.resize(rect).then(() => tauriBrowser.show());
        } else {
          tauriBrowser.show();
        }
      }, 260);
      return () => clearTimeout(timer);
    }
  }, [isContentViewerHidden, getRect]);

  // ── Navigation ────────────────────────────────────────────────────────────

  const handleNavigate = (targetUrl: string) => {
    let normalized = targetUrl.trim();
    if (normalized && !normalized.startsWith('http') && !normalized.startsWith('about:')) {
      normalized = `https://${normalized}`;
    }
    setInputUrl(normalized);
    tauriBrowser.navigate(normalized);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleNavigate(inputUrl);
  };

  const handleRefresh = () => {
    tauriBrowser.reload();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Address Bar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-edge bg-slate-raised px-3">
        {/* Back / Forward / Refresh */}
        <div className="flex items-center gap-1">
          <button
            className="rounded p-1 text-xs text-text-tertiary transition-colors hover:bg-edge hover:text-text-secondary"
            aria-label="后退"
            title="后退"
          >
            ←
          </button>
          <button
            className="rounded p-1 text-xs text-text-tertiary transition-colors hover:bg-edge hover:text-text-secondary"
            aria-label="前进"
            title="前进"
          >
            →
          </button>
          <button
            onClick={handleRefresh}
            className="rounded p-1 text-xs text-text-tertiary transition-colors hover:bg-edge hover:text-text-secondary"
            aria-label="刷新"
            title="刷新"
          >
            ↺
          </button>
        </div>

        {/* URL Input */}
        <input
          type="text"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 rounded-lg border border-edge bg-slate-deep px-3 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          placeholder="输入网址，按回车访问..."
          aria-label="地址栏"
        />

        {/* AI Takeover Indicator */}
        <div className="flex items-center gap-1.5 text-xs">
          <span
            className={[
              'h-2 w-2 rounded-full',
              isAIControlled ? 'bg-success' : 'bg-text-tertiary',
            ].join(' ')}
            aria-hidden="true"
          />
          <span className={isAIControlled ? 'text-success' : 'text-text-tertiary'}>
            {isAIControlled ? 'AI 已接管' : '仅浏览'}
          </span>
        </div>
      </div>

      {/* Native WebView placeholder — transparent, sized to fill remaining space */}
      <div
        ref={placeholderRef}
        className="flex-1"
        aria-label="浏览器内容区"
        aria-hidden="true"
      />
    </div>
  );
}
