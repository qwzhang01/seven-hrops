import { useState } from 'react';

export type OutputViewerType = 'markdown' | 'html' | 'image' | 'unknown';

interface OutputViewerProps {
  type: OutputViewerType;
  /** Text content (markdown/html) or data URL / URL (image) */
  content: string;
}

/**
 * OutputViewer — generic artifact preview component.
 *
 * Supports: Markdown / HTML (sandboxed iframe) / Image / Unknown (fallback).
 * This component is pure UI — no store writes, no Tauri invoke.
 */
export function OutputViewer({ type, content }: OutputViewerProps) {
  switch (type) {
    case 'markdown':
      return <MarkdownView content={content} />;
    case 'html':
      return <HtmlView content={content} />;
    case 'image':
      return <ImageView src={content} />;
    default:
      return <FallbackView />;
  }
}

// ── Markdown (simple whitespace-preserving renderer) ──────────────────

function MarkdownView({ content }: { content: string }) {
  // Split into lines and render with basic styling
  const lines = content.split('\n');

  return (
    <div className="h-full overflow-y-auto scroll-soft px-6 py-4">
      <div className="space-y-1 text-sm text-text-secondary">
        {lines.map((line, i) => {
          if (line.startsWith('### ')) {
            return <h3 key={i} className="mt-4 text-base font-semibold text-text-primary">{line.slice(4)}</h3>;
          }
          if (line.startsWith('## ')) {
            return <h2 key={i} className="mt-5 text-lg font-bold text-text-primary">{line.slice(3)}</h2>;
          }
          if (line.startsWith('# ')) {
            return <h1 key={i} className="mt-6 text-xl font-bold text-text-primary">{line.slice(2)}</h1>;
          }
          if (line.startsWith('```')) {
            return null; // code fence markers hidden
          }
          if (line.startsWith('- ') || line.startsWith('* ')) {
            return (
              <div key={i} className="flex gap-2">
                <span className="shrink-0 text-text-tertiary">•</span>
                <span>{line.slice(2)}</span>
              </div>
            );
          }
          if (line.trim() === '') {
            return <div key={i} className="h-2" />;
          }
          return <p key={i}>{line}</p>;
        })}
      </div>
    </div>
  );
}

// ── HTML (sandboxed iframe) ───────────────────────────────────────────

function HtmlView({ content }: { content: string }) {
  return (
    <iframe
      srcDoc={content}
      sandbox="allow-scripts"
      className="h-full w-full border-0 bg-white"
      title="HTML 预览"
    />
  );
}

// ── Image ─────────────────────────────────────────────────────────────

function ImageView({ src }: { src: string }) {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <>
      <div
        className="flex h-full cursor-zoom-in items-center justify-center overflow-auto bg-slate-deep p-4"
        onClick={() => setFullscreen(true)}
        title="点击全屏查看"
      >
        <img
          src={src}
          alt="预览"
          className="max-h-full max-w-full rounded-lg object-contain shadow-lg"
        />
      </div>

      {fullscreen && (
        <div
          className="fixed inset-0 z-[300] flex cursor-zoom-out items-center justify-center bg-black/90"
          onClick={() => setFullscreen(false)}
        >
          <img
            src={src}
            alt="全屏预览"
            className="max-h-screen max-w-screen-xl object-contain"
          />
        </div>
      )}
    </>
  );
}

// ── Fallback ──────────────────────────────────────────────────────────

function FallbackView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-text-tertiary opacity-40">
        <path d="M8 10h24v24H8zM8 10l6-6h10l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M20 20v6M20 18v-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <p className="text-sm text-text-secondary">暂不支持预览此格式</p>
      <p className="text-xs text-text-tertiary">请在文件管理器中打开查看</p>
    </div>
  );
}
