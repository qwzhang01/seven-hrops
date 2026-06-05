import { useState } from 'react';

interface OutputPreviewProps {
  outputId?: string;
}

/**
 * OutputPreview — AI-generated content preview.
 * Supports Markdown rendering and HTML local web server preview.
 * Export options: Word / PDF / HTML / Markdown.
 */
export function OutputPreview({ outputId }: OutputPreviewProps) {
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [previewServerUrl] = useState<string | null>(null); // TODO: connect to Tauri preview server
  const [lanUrl] = useState<string | null>(null);

  // Mock content — replace with real output store
  const mockContent = `# 简历筛选报告

## 候选人：张三

**综合评分：88/100**

### 技能匹配度
- ✅ React / Vue 前端框架：**精通**
- ✅ TypeScript：**熟练**
- ✅ 5年工作经验：**符合要求**
- ⚠️ 英语能力：**待确认**

### 推荐意见
该候选人技术背景与岗位要求高度匹配，建议安排技术面试。

---
*由 Seven: HROps AI 生成 · ${new Date().toLocaleDateString()}*
`;

  const isHtml = outputId?.endsWith('.html') ?? false;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-edge bg-slate-raised px-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode('preview')}
            className={[
              'rounded px-2.5 py-1 text-xs transition-colors',
              mode === 'preview'
                ? 'bg-primary/20 text-primary'
                : 'text-text-tertiary hover:text-text-secondary',
            ].join(' ')}
          >
            预览
          </button>
          <button
            onClick={() => setMode('edit')}
            className={[
              'rounded px-2.5 py-1 text-xs transition-colors',
              mode === 'edit'
                ? 'bg-primary/20 text-primary'
                : 'text-text-tertiary hover:text-text-secondary',
            ].join(' ')}
          >
            编辑
          </button>
        </div>

        {/* Export button */}
        <div className="relative">
          <button className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-1 text-xs text-text-secondary transition-colors hover:bg-edge hover:text-text-primary">
            <span>⬇</span>
            <span>导出</span>
          </button>
        </div>
      </div>

      {/* HTML Preview Server Notification */}
      {isHtml && (
        <div className="flex shrink-0 items-center gap-3 border-b border-edge bg-success/10 px-4 py-2">
          <span className="text-xs text-success">🌐 本地预览服务</span>
          {previewServerUrl ? (
            <>
              <span className="text-xs text-text-secondary">
                本机：<code className="text-success">{previewServerUrl}</code>
              </span>
              {lanUrl && (
                <span className="text-xs text-text-secondary">
                  局域网：<code className="text-success">{lanUrl}</code>
                </span>
              )}
              <button className="ml-auto text-xs text-text-tertiary hover:text-error">
                停止服务
              </button>
            </>
          ) : (
            <span className="text-xs text-text-tertiary">正在启动预览服务...</span>
          )}
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto scroll-soft p-4">
        {mode === 'preview' ? (
          <div
            className="prose prose-invert max-w-none text-sm"
            style={{
              color: 'var(--color-text-secondary)',
              lineHeight: '1.7',
            }}
          >
            {/* Simple markdown-like rendering — replace with marked.js */}
            {mockContent.split('\n').map((line, i) => {
              if (line.startsWith('# '))
                return (
                  <h1 key={i} className="mb-3 text-xl font-bold text-text-primary">
                    {line.slice(2)}
                  </h1>
                );
              if (line.startsWith('## '))
                return (
                  <h2 key={i} className="mb-2 mt-4 text-base font-semibold text-text-primary">
                    {line.slice(3)}
                  </h2>
                );
              if (line.startsWith('### '))
                return (
                  <h3 key={i} className="mb-1.5 mt-3 text-sm font-semibold text-text-primary">
                    {line.slice(4)}
                  </h3>
                );
              if (line.startsWith('---'))
                return <hr key={i} className="my-3 border-edge" />;
              if (line.startsWith('- '))
                return (
                  <div key={i} className="flex items-start gap-2 py-0.5 text-xs">
                    <span className="mt-0.5 text-text-tertiary">•</span>
                    <span dangerouslySetInnerHTML={{ __html: line.slice(2).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                  </div>
                );
              if (line.trim() === '') return <div key={i} className="h-2" />;
              return (
                <p key={i} className="text-xs leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}
                />
              );
            })}
          </div>
        ) : (
          <textarea
            defaultValue={mockContent}
            className="h-full w-full resize-none bg-transparent text-xs text-text-secondary focus:outline-none"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}
