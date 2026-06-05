import type { ReactNode } from 'react';

interface NavItemProps {
  /** Icon element or emoji */
  icon: ReactNode;
  /** Display label */
  label: string;
  /** Whether this item is currently active */
  isActive?: boolean;
  /** Unread badge count (0 = hidden) */
  badge?: number;
  /** Click handler */
  onClick?: () => void;
  /** Whether the panel is in collapsed (icon-only) mode */
  collapsed?: boolean;
}

/**
 * NavItem — left navigation item with active state indicator.
 * Active state: 3px purple left border + background highlight.
 * Supports unread badge and collapsed (icon-only) mode.
 */
export function NavItem({
  icon,
  label,
  isActive = false,
  badge = 0,
  onClick,
  collapsed = false,
}: NavItemProps) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={[
        'relative flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-sm transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        isActive
          ? 'bg-primary/10 text-text-primary'
          : 'text-text-secondary hover:bg-slate-raised hover:text-text-primary',
        collapsed ? 'justify-center px-2' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Active indicator — 3px left border */}
      {isActive && (
        <span
          className="absolute left-0 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-r-full bg-primary"
          aria-hidden="true"
        />
      )}

      {/* Icon */}
      <span className="shrink-0 text-base leading-none">{icon}</span>

      {/* Label (hidden in collapsed mode) */}
      {!collapsed && (
        <span className="flex-1 truncate font-medium">{label}</span>
      )}

      {/* Unread badge */}
      {badge > 0 && (
        <span
          className={[
            'flex h-2 w-2 shrink-0 items-center justify-center rounded-full bg-error',
            collapsed ? '' : 'ml-auto',
          ].join(' ')}
          aria-label={`${badge} 条未读`}
        />
      )}
    </button>
  );
}
