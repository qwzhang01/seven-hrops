import { useCallback, useRef, useState } from 'react';

interface PanelResizerProps {
  /** Called with pixel delta during drag */
  onResize: (delta: number) => void;
  /** Called when drag ends (for persistence) */
  onResizeEnd?: () => void;
  /** Called on double-click (for reset) */
  onDoubleClick?: () => void;
  /** Minimum width of the left panel in pixels */
  minLeft: number;
  /** Minimum width of the right panel in pixels */
  minRight: number;
  /** Total available width (used for constraint calculation) */
  totalWidth: number;
  /** ARIA label */
  label?: string;
}

/**
 * PanelResizer — draggable vertical divider between two panels.
 * Enforces min-width constraints on both sides.
 * Provides hover/drag visual feedback via CSS classes.
 */
export function PanelResizer({
  onResize,
  onResizeEnd,
  onDoubleClick,
  minLeft,
  minRight,
  totalWidth,
  label = '拖拽调整面板宽度',
}: PanelResizerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const startXRef = useRef(0);
  const accumulatedDeltaRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      accumulatedDeltaRef.current = 0;
      setIsDragging(true);

      // Prevent text selection globally during drag
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMouseMove = (ev: MouseEvent) => {
        const rawDelta = ev.clientX - startXRef.current;
        // Clamp delta so neither side goes below minimum
        const clampedDelta = Math.max(
          -(totalWidth - minLeft - minRight),
          Math.min(totalWidth - minLeft - minRight, rawDelta)
        );
        const diff = clampedDelta - accumulatedDeltaRef.current;
        accumulatedDeltaRef.current = clampedDelta;
        onResize(diff);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        onResizeEnd?.();
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [onResize, onResizeEnd, minLeft, minRight, totalWidth]
  );

  const handleDoubleClick = useCallback(() => {
    onDoubleClick?.();
  }, [onDoubleClick]);

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative shrink-0 w-1 cursor-col-resize select-none"
      style={{ zIndex: 10 }}
    >
      {/* Visual indicator line */}
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all"
        style={{
          width: isDragging ? 3 : isHovered ? 2 : 1,
          background: isDragging
            ? '#7C5CFF'
            : isHovered
            ? 'rgba(124, 92, 255, 0.4)'
            : 'rgba(38, 43, 54, 0.8)',
          boxShadow: isDragging ? '0 0 8px rgba(124, 92, 255, 0.5)' : 'none',
          borderRadius: 2,
          transition: 'width 100ms ease, background 100ms ease, box-shadow 100ms ease',
        }}
      />
    </div>
  );
}
