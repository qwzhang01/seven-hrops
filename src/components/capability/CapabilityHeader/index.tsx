import { useState, useMemo } from 'react'
import { useCapabilityStore } from '@/stores/capabilityStore'

export function CapabilityHeader() {
  const records = useCapabilityStore((s) => s.records)
  const visibleRecords = useMemo(
    () => records.filter((r) => !r.manifest.spec.hidden),
    [records],
  )
  const activeCapabilityId = useCapabilityStore((s) => s.activeCapabilityId)
  const activateCapability = useCapabilityStore((s) => s.activateCapability)
  const active = useCapabilityStore((s) => s.getActive())

  const [open, setOpen] = useState(false)

  return (
    <div
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--color-border, #334155)',
        background: 'var(--color-surface, #0f172a)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        position: 'relative',
      }}
    >
      {/* Icon + Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        {active ? (
          <>
            {active.manifest.metadata.icon && (
              <span style={{ fontSize: 20 }}>{active.manifest.metadata.icon}</span>
            )}
            <span
              style={{
                color: 'var(--color-text-primary, #e2e8f0)',
                fontWeight: 600,
                fontSize: 15,
              }}
            >
              {active.manifest.metadata.displayName}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--color-text-muted, #64748b)', fontSize: 14 }}>
            选择一个能力开始
          </span>
        )}
      </div>

      {/* Switch button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid var(--color-border, #334155)',
          background: 'transparent',
          color: 'var(--color-text-secondary, #94a3b8)',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        切换
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 16,
            zIndex: 100,
            background: 'var(--color-surface-secondary, #1e293b)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: 10,
            minWidth: 200,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            overflow: 'hidden',
          }}
        >
          {visibleRecords.length === 0 && (
            <div
              style={{
                padding: '12px 16px',
                color: 'var(--color-text-muted, #64748b)',
                fontSize: 13,
              }}
            >
              暂无可用能力
            </div>
          )}
          {visibleRecords.map((rec) => (
            <button
              key={rec.id}
              onClick={() => {
                activateCapability(rec.id)
                setOpen(false)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '10px 16px',
                border: 'none',
                background:
                  rec.id === activeCapabilityId
                    ? 'rgba(59, 130, 246, 0.15)'
                    : 'transparent',
                color:
                  rec.id === activeCapabilityId
                    ? 'var(--color-primary, #3b82f6)'
                    : 'var(--color-text-primary, #e2e8f0)',
                fontSize: 14,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {rec.manifest.metadata.icon && (
                <span style={{ fontSize: 16 }}>{rec.manifest.metadata.icon}</span>
              )}
              {rec.manifest.metadata.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
