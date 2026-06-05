import { useState, useCallback, useRef, useEffect } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore } from '@/stores/workspaceStore'

interface DropZoneProps {
  /** Capability id used to auto-create workspace if none exists. */
  capabilityId?: string
  children: React.ReactNode
}

/**
 * DropZone — wraps the chat area to accept file drops.
 *
 * Tauri desktop file drops are delivered as native webview drag-drop events
 * with absolute file paths, not as browser File objects. Browser DOM drag/drop
 * is kept only as a development fallback.
 *
 * Layer: L6 Component — reads/writes workspaceStore only, no direct service calls.
 */
export function DropZone({ capabilityId = 'resume-screening', children }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const dragCounterRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const { importInputFiles } = useWorkspaceStore(
    useShallow((s) => ({
      importInputFiles: s.importInputFiles,
    }))
  )

  const handleDrop = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        setError('没有收到可导入的文件路径')
        setSuccess(null)
        return
      }

      setIsProcessing(true)
      setError(null)
      setSuccess(null)
      try {
        const result = await importInputFiles(paths, capabilityId)
        if (result.failureCount > 0) {
          const firstFailure = result.failures[0]
          const prefix = result.successCount > 0
            ? `已导入 ${result.successCount} 个文件，失败 ${result.failureCount} 个：`
            : '文件导入失败：'
          setError(`${prefix}${firstFailure.message}`)
          return
        }
        setSuccess(`已导入 ${result.successCount} 个文件到 01_inputs/`)
      } catch (err) {
        setError(err instanceof Error ? err.message : '文件上传失败')
      } finally {
        setIsProcessing(false)
      }
    },
    [capabilityId, importInputFiles]
  )

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload
        if (payload.type === 'enter') {
          dragCounterRef.current = 1
          setIsDragOver(true)
          return
        }
        if (payload.type === 'over') {
          setIsDragOver(true)
          return
        }
        if (payload.type === 'leave') {
          dragCounterRef.current = 0
          setIsDragOver(false)
          return
        }
        if (payload.type === 'drop') {
          dragCounterRef.current = 0
          setIsDragOver(false)
          handleDrop(payload.paths)
        }
      })
      .then((dispose) => {
        if (cancelled) {
          dispose()
          return
        }
        unlisten = dispose
      })
      .catch((err) => {
        console.warn('[DropZone] Failed to register Tauri drag-drop listener:', err)
      })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [handleDrop])

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {children}

      {/* Drag overlay */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-primary">
            <path d="M20 8v16M12 16l8-8 8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 28h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <p className="text-sm font-medium text-primary">释放以上传文件</p>
          <p className="text-xs text-text-tertiary">文件将写入工作空间 01_inputs/</p>
        </div>
      )}

      {/* Processing overlay */}
      {isProcessing && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg bg-slate-deep/80 backdrop-blur-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-text-secondary">正在写入文件...</p>
        </div>
      )}

      {/* Success toast */}
      {success && (
        <div
          className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-green-500/90 px-4 py-2 text-sm text-white shadow-lg"
          onClick={() => setSuccess(null)}
          role="status"
        >
          {success}
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div
          className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-red-500/90 px-4 py-2 text-sm text-white shadow-lg"
          onClick={() => setError(null)}
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  )
}
