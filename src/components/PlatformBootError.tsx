/**
 * PlatformBootError — 平台底座加载失败时的降级 UI（Phase B Task 6.6）。
 *
 * 这是一个 **零依赖** 的小组件：当 `bootstrapPlatform()` reject 时
 * `main.tsx` 用它取代 `<App />`，因此本组件 MUST NOT 依赖：
 *   - `window.__platform`（恰好就是失败的对象）
 *   - 任何 store / runtime / agentService（同上）
 *   - 任何重逻辑的 UI 库
 *
 * 提供的能力：
 *   1. 渲染错误码 + 折叠堆栈（debug 用）。
 *   2. **重试**按钮：调用调用方注入的 `onRetry`，让 main.tsx 重新跑
 *      `bootstrapPlatform`。
 *   3. **打开审计日志**按钮：通过 `@tauri-apps/api/core invoke` 调
 *      `open_audit_log`，再用 `@tauri-apps/plugin-shell open` 打开文件
 *      所在目录。命令在浏览器 dev 环境（无 Tauri runtime）会优雅降级
 *      为提示用户路径。
 */

import React, { useCallback, useState } from "react"

export interface PlatformBootErrorProps {
  readonly error: unknown
  /** 触发重试。main.tsx 会重新调用 bootstrapPlatform 并替换组件。 */
  readonly onRetry?: () => void
}

const containerStyle: React.CSSProperties = {
  padding: "32px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  color: "#1f2937",
  maxWidth: 720,
  margin: "0 auto",
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  color: "#dc2626",
}

const buttonRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
  marginTop: 16,
  flexWrap: "wrap",
}

const baseButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid #d1d5db",
  background: "#ffffff",
  cursor: "pointer",
  fontSize: 14,
  color: "#1f2937",
}

const primaryButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  background: "#2563eb",
  color: "#ffffff",
  border: "1px solid #2563eb",
}

const preStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  background: "#f3f4f6",
  borderRadius: 6,
  fontSize: 12,
  whiteSpace: "pre-wrap",
  overflowX: "auto",
}

/**
 * Extract the structured error code (if the error is a `ValidationError`
 * from the platform layer, it carries a `.code` field). Falls back to
 * "UNKNOWN" so the UI always has something to show.
 */
const extractErrorCode = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const c = (error as { code?: unknown }).code
    if (typeof c === "string") return c
  }
  return "UNKNOWN"
}

const extractStack = (error: unknown): string => {
  if (error instanceof Error && typeof error.stack === "string") {
    return error.stack
  }
  return String(error)
}

export const PlatformBootError: React.FC<PlatformBootErrorProps> = ({
  error,
  onRetry,
}) => {
  const [stackOpen, setStackOpen] = useState(false)
  const [auditMessage, setAuditMessage] = useState<string | null>(null)

  const errorCode = extractErrorCode(error)
  const detail = error instanceof Error ? error.message : String(error)
  const stack = extractStack(error)

  const handleOpenAuditLog = useCallback(async () => {
    try {
      // Lazy-imported so this component remains usable in non-Tauri dev
      // environments (the dynamic import will fail gracefully).
      const { invoke } = await import("@tauri-apps/api/core")
      const result = (await invoke("open_audit_log", {
        args: { session_id: "system" },
      })) as { path: string; exists: boolean }

      if (!result.exists) {
        setAuditMessage(
          `审计日志尚未生成。预期位置：${result.path}`,
        )
        return
      }

      const { open } = await import("@tauri-apps/plugin-shell")
      // Open the *containing directory* — opening the .jsonl file
      // directly would launch a text editor which on most platforms
      // chokes on multi-MB JSONL streams.
      const dir = result.path.replace(/\/[^/]+$/, "")
      await open(dir)
      setAuditMessage(`已在文件管理器中打开：${dir}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setAuditMessage(`打开审计日志失败：${msg}`)
    }
  }, [])

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>平台底座加载失败</h1>
      <p style={{ marginTop: 12, fontSize: 14 }}>
        错误码：<code>{errorCode}</code>
      </p>
      <pre style={preStyle}>{detail}</pre>

      <div style={buttonRowStyle}>
        {onRetry ? (
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={onRetry}
          >
            重试
          </button>
        ) : null}
        <button
          type="button"
          style={baseButtonStyle}
          onClick={handleOpenAuditLog}
        >
          打开审计日志
        </button>
        <button
          type="button"
          style={baseButtonStyle}
          onClick={() => setStackOpen((s) => !s)}
        >
          {stackOpen ? "收起堆栈" : "展开堆栈"}
        </button>
      </div>

      {auditMessage ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "#374151" }}>
          {auditMessage}
        </p>
      ) : null}

      {stackOpen ? <pre style={preStyle}>{stack}</pre> : null}
    </div>
  )
}
