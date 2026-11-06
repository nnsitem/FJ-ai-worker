'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePopupPosition } from '@/lib/popup-layer';
import { CheckMarkIcon } from './icons';

/**
 * The app's one dropdown. A native <select> can't carry a second line per
 * option, and its popup is the OS's own — it can't be themed and looked wrong
 * against this palette — so every chooser draws this list instead: the
 * session's agent picker, the Team board's project filter, and whatever comes
 * next. Styles live under `.ao-picker*` in board.css.
 */

export interface PickerOption<T extends string | number> {
  value: T;
  label: string;
  /** Optional second line — what the choice actually means. */
  hint?: string;
  /** Its own mark, in place of the picker's `icon` (the agent picker's logos). */
  icon?: IconComponent;
}

type IconComponent = React.ComponentType<{ size?: number }>;

export function Picker<T extends string | number>({
  value,
  options,
  onChange,
  icon: Icon,
  placement = 'down',
  ariaLabel,
  disabled = false,
}: {
  value: T;
  options: PickerOption<T>[];
  onChange: (next: T) => void;
  /** Shown on the trigger and beside every item. */
  icon?: IconComponent;
  /** 'up' for controls pinned to the bottom of the window (the status line);
   *  'down' hangs from the trigger's right edge (header controls), and
   *  'down-start' from its left (form fields). */
  placement?: 'up' | 'down' | 'down-start';
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // In <body>, beside the trigger (lib/popup-layer.ts) — inside a page, a
  // glass panel or card could paint over it.
  const pos = usePopupPosition(open, rootRef, menuRef, placement);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Claimed: an Escape that closes this menu shouldn't also close what it
      // sits in (the Team board's task panel checks defaultPrevented).
      e.preventDefault();
      setOpen(false);
    };
    // Both captured: a click that also lands on something else still closes
    // this, and Escape reaches this before any bubble-phase window listener.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const TriggerIcon = current?.icon ?? Icon;

  return (
    <div className="ao-picker" ref={rootRef}>
      <button
        type="button"
        className="ao-picker-trigger"
        data-open={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {TriggerIcon && <TriggerIcon size={13} />}
        <span className="ao-picker-value">{current?.label ?? ''}</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="ao-picker-menu"
            data-popup-layer=""
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? undefined : 'hidden',
              ...(pos?.maxHeight ? { maxHeight: pos.maxHeight } : {}),
              ...(pos?.maxWidth ? { maxWidth: pos.maxWidth, minWidth: 0 } : {}),
            }}
            role="listbox"
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className="ao-picker-item"
                data-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {(() => {
                  const ItemIcon = option.icon ?? Icon;
                  return (
                    ItemIcon && (
                      <span className="ao-picker-item-icon">
                        <ItemIcon size={15} />
                      </span>
                    )
                  );
                })()}
                <span className="ao-picker-item-text">
                  <span className="ao-picker-item-name">{option.label}</span>
                  {option.hint && <span className="ao-picker-item-hint">{option.hint}</span>}
                </span>
                {option.value === value && (
                  <span className="ao-picker-check">
                    <CheckMarkIcon size={14} />
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
