'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Dropdowns (Picker, DatePicker) render into <body>, above everything, and are
 * placed next to their trigger here. Inside a page they could be covered: a
 * glass panel or card is its own stacking context, so a menu's z-index only
 * counts within it, and the next card or panel over paints on top.
 *
 * Every portalled popup carries `data-popup-layer`; a menu that closes on an
 * outside click checks `inPopupLayer` too, so picking from a dropdown that
 * sits in it (and now lives in <body>) doesn't count as clicking away.
 */
export const POPUP_LAYER_ATTR = 'data-popup-layer';

export function inPopupLayer(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(`[${POPUP_LAYER_ATTR}]`);
}

export type PopupPlacement = 'up' | 'down' | 'down-start';

export interface PopupPosition {
  top: number;
  left: number;
  maxHeight?: number;
  maxWidth?: number;
}

const GAP = 6;
const EDGE = 8;

/**
 * Where an open popup goes: below (or above, for 'up') its trigger, from the
 * trigger's left edge — or its right, for 'down' — flipped and clamped to stay
 * in the window. Follows the trigger while anything scrolls or resizes.
 */
export function usePopupPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  placement: PopupPlacement
): PopupPosition | null {
  const [pos, setPos] = useState<PopupPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const t = trigger.getBoundingClientRect();
      const W = window.innerWidth;
      const H = window.innerHeight;
      // Natural size, before any limit from a previous placement.
      const prevMaxH = menu.style.maxHeight;
      const prevMaxW = menu.style.maxWidth;
      menu.style.maxHeight = '';
      menu.style.maxWidth = '';
      const m = menu.getBoundingClientRect();
      menu.style.maxHeight = prevMaxH;
      menu.style.maxWidth = prevMaxW;

      const width = Math.min(m.width, W - 2 * EDGE);
      const fitsX = (x: number) => x >= EDGE && x + width <= W - EDGE;
      const startX = t.left;
      const endX = t.right - width;
      const preferEnd = placement === 'down';
      let left = preferEnd ? (fitsX(endX) ? endX : startX) : fitsX(startX) ? startX : endX;
      left = Math.min(Math.max(left, EDGE), W - EDGE - width);

      const below = H - t.bottom - GAP - EDGE;
      const above = t.top - GAP - EDGE;
      let up = placement === 'up';
      if (up && m.height > above && below > above) up = false;
      if (!up && m.height > below && above > below) up = true;
      const room = up ? above : below;
      const height = Math.min(m.height, room);
      const top = up ? t.top - GAP - height : t.bottom + GAP;

      setPos({
        top: Math.round(top),
        left: Math.round(left),
        ...(m.height > room ? { maxHeight: Math.floor(room) } : {}),
        ...(m.width > W - 2 * EDGE ? { maxWidth: W - 2 * EDGE } : {}),
      });
    };
    // The menu's own list scrolling never moves its trigger; re-measuring then
    // (lifting its max-height for a frame) only made the list jump.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      place();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, triggerRef, menuRef, placement]);

  // A closed popup has no position; the next open measures afresh before it
  // paints (a layout effect), so the last spot never shows.
  return open ? pos : null;
}
