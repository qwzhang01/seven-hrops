/**
 * SilentSwitchToast — Phase G Task 9.2
 *
 * A 3-second countdown toast that appears when the assistant silently switches
 * to a new capability. Shows a progress bar and an undo button.
 */

import { useEffect, useState } from "react"
import { useSilentSwitchStore } from "@/stores/silentSwitchStore"
import { useCapabilityStore } from "@/stores/capabilityStore"

export function SilentSwitchToast() {
  const pendingSwitch = useSilentSwitchStore((s) => s.pendingSwitch)
  const countdown = useSilentSwitchStore((s) => s.countdown)
  const undo = useSilentSwitchStore((s) => s.undo)

  const records = useCapabilityStore((s) => s.records)

  const [isUndoing, setIsUndoing] = useState(false)

  // Reset undoing state when pendingSwitch clears
  useEffect(() => {
    if (!pendingSwitch) setIsUndoing(false)
  }, [pendingSwitch])

  if (!pendingSwitch) return null

  const targetRecord = records.find((r) => r.id === pendingSwitch.toCapability)
  const targetName = targetRecord?.manifest.metadata.displayName ?? pendingSwitch.toCapability

  const handleUndo = async () => {
    setIsUndoing(true)
    await undo()
  }

  // Progress percentage (3s total, countdown goes 3→2→1→0)
  const progress = (countdown / 3) * 100

  return (
    <div
      data-testid="silent-switch-toast"
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: "var(--color-surface-secondary, #1e293b)",
        border: "1px solid var(--color-border, #334155)",
        borderRadius: 12,
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
        minWidth: 280,
      }}
    >
      {/* Progress bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: 3,
          width: `${progress}%`,
          background: "var(--color-primary, #3b82f6)",
          borderRadius: "0 0 12px 12px",
          transition: "width 1s linear",
        }}
      />

      {/* Content */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            color: "var(--color-text-primary, #e2e8f0)",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          已切换到「{targetName}」
        </div>
        <div
          style={{
            color: "var(--color-text-muted, #64748b)",
            fontSize: 12,
            marginTop: 2,
          }}
        >
          {countdown}s 后确认
        </div>
      </div>

      {/* Undo button */}
      <button
        data-testid="silent-switch-undo"
        onClick={handleUndo}
        disabled={isUndoing}
        style={{
          padding: "6px 14px",
          borderRadius: 8,
          border: "1px solid var(--color-primary, #3b82f6)",
          background: "transparent",
          color: "var(--color-primary, #3b82f6)",
          fontSize: 13,
          fontWeight: 500,
          cursor: isUndoing ? "not-allowed" : "pointer",
          opacity: isUndoing ? 0.5 : 1,
        }}
      >
        {isUndoing ? "撤销中..." : "撤销"}
      </button>
    </div>
  )
}
